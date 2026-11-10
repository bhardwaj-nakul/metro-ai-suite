// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from "react";
import { getAdapters } from "@/adapters";
import { SpatialMap } from "@/features/map/SpatialMap";
import { planSize } from "@/features/map/geometry";
import { stopNumbers } from "@/features/map/route";
import { getThumbnail, toDataUrl } from "@/lib/thumbnails";
import { svgToPng } from "@/lib/svgRaster";
import { uid } from "@/lib/utils";
import { useFloorplanStore } from "@/stores/floorplan";
import { useReportsStore, type GeneratedReport } from "@/stores/reports";
import type { TraceStop } from "@/stores/case";
import { reportFileName, type ReportContent } from "./content";
import { useKnownTags } from "@/hooks/queries";

export interface GenerateArgs {
  report: ReportContent;
  stops: TraceStop[];
  subjectImage?: string;
  sessionId?: string;
}

/** Thumbnails fetched for the PDF; later sightings are listed without one. */
const THUMB_LIMIT = 24;

/**
 * An image jsPDF can embed: PNG or JPEG as a data URL. Other types (WebP,
 * GIF, SVG) are redrawn through a canvas as PNG.
 */
async function pdfImage(src: string): Promise<string> {
  const data = await toDataUrl(src);
  if (/^data:image\/(png|jpe?g)[;,]/i.test(data)) return data;
  const img = new Image();
  img.src = data;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  return canvas.toDataURL("image/png");
}

async function stopThumb(s: TraceStop): Promise<string | undefined> {
  try {
    if (s.hit.posterUrl) return await pdfImage(s.hit.posterUrl);
    if (s.hit.playbackUrl)
      return await pdfImage(await getThumbnail(s.hit.playbackUrl, s.hit.seekS));
  } catch {
    // a missing frame should not block the report
  }
  return undefined;
}

const nextFrame = () =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/**
 * Builds incident PDFs. The route map is drawn by mounting a static
 * SpatialMap off-screen and rasterising it, so the PDF matches the UI.
 * Render `offscreen` somewhere in the tree.
 */
export function useReportGenerator() {
  const plan = useFloorplanStore((s) => s.plan);
  const vssTags = useKnownTags();
  const add = useReportsStore((s) => s.add);
  const [job, setJob] = useState<TraceStop[]>();
  const [busy, setBusy] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const waiting = useRef<(v: SVGSVGElement | null) => void>(undefined);

  useEffect(() => {
    if (!job || !waiting.current) return;
    const resolve = waiting.current;
    void nextFrame().then(() => resolve(svg.current));
  }, [job]);

  const generate = useCallback(
    async (args: GenerateArgs): Promise<GeneratedReport> => {
      setBusy(true);
      try {
        let mapPng: string | undefined;
        let mapError: string | undefined;
        if (args.stops.length) {
          const el = await new Promise<SVGSVGElement | null>((resolve) => {
            waiting.current = resolve;
            setJob(args.stops);
          });
          try {
            if (!el) throw new Error("the map did not render");
            mapPng = await svgToPng(el);
          } catch (e) {
            mapError = (e as Error).message;
          }
          setJob(undefined);
        }
        const thumbs: Record<number, string> = {};
        for (const s of args.stops.slice(0, THUMB_LIMIT)) {
          const t = await stopThumb(s);
          if (t) thumbs[s.order] = t;
        }
        let subjectImage: string | undefined;
        let subjectImageError: string | undefined;
        if (args.subjectImage) {
          try {
            subjectImage = await pdfImage(args.subjectImage);
          } catch (e) {
            subjectImageError = (e as Error).message || "image did not load";
          }
        }
        const size = planSize(plan);
        const at = new Date();
        // jsPDF is large; load it only when a report is actually generated.
        const { buildReportPdf } = await import("./pdf");
        const doc = buildReportPdf({
          report: args.report,
          stops: args.stops,
          numbers: stopNumbers(args.stops, plan),
          thumbs,
          thumbLimit: THUMB_LIMIT,
          subjectImage,
          subjectImageError,
          mapPng,
          mapAspect: size.height / size.width,
          mapError,
          sessionId: getAdapters().mock ? undefined : args.sessionId,
          generatedAt: at,
        });
        const blob = doc.output("blob");
        const report: GeneratedReport = {
          id: uid("report"),
          title: args.report.title,
          fileName: reportFileName(args.report.title, at),
          createdAt: at.getTime(),
          blobUrl: URL.createObjectURL(blob),
          sessionId: args.sessionId,
        };
        add(report);
        return report;
      } finally {
        setBusy(false);
      }
    },
    [plan, add],
  );

  const offscreen = job ? (
    <div
      aria-hidden
      className="pointer-events-none fixed top-0 left-[-12000px] w-[1000px] opacity-100"
    >
      <SpatialMap
        plan={plan}
        vssTags={vssTags}
        stops={job}
        animate={false}
        labels="route"
        svgRef={svg}
      />
    </div>
  ) : null;

  return { generate, busy, offscreen };
}

/** Save a generated report to disk. */
export function downloadReport(
  r: Pick<GeneratedReport, "blobUrl" | "fileName">,
) {
  const a = document.createElement("a");
  a.href = r.blobUrl;
  a.download = r.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
