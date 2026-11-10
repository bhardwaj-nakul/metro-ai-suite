// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { jsPDF } from "jspdf";
import type { VssHit } from "@/adapters/vss/types";
import { hitCameraLabel, hitMatchesRef } from "@/lib/hits";
import {
  formatClock,
  formatDateTime,
  formatDay,
  formatGap,
  formatOffset,
} from "@/lib/time";
import { movementLegs, type TraceStop } from "@/stores/case";
import { PRESET_LABEL, type ReportContent } from "./content";
import { cameraZone } from "@/stores/floorplan";
import { pdfProse, toPdfText } from "./pdfText";

/** "camera_1 (Lobby)": the hit's camera and, when on the plan, its zone. */
function cameraWithZone(h: VssHit): string {
  const zone = cameraZone(h.cameraTag);
  return toPdfText(`${hitCameraLabel(h)}${zone ? ` (${zone})` : ""}`);
}

export interface ReportPdfInput {
  report: ReportContent;
  /** Ordered route (routeFromSightings). */
  stops: TraceStop[];
  /** Map marker number by stop order (stopNumbers); off-plan stops have none. */
  numbers?: Map<number, number>;
  /** Thumbnail data URLs (PNG or JPEG) keyed by stop order. */
  thumbs?: Record<number, string>;
  /** Only the first this-many stops had a thumbnail fetched. */
  thumbLimit?: number;
  /** Subject reference image as a PNG or JPEG data URL. */
  subjectImage?: string;
  /** Why the subject image couldn't be included. */
  subjectImageError?: string;
  /** Rasterised SpatialMap (PNG data URL). */
  mapPng?: string;
  mapAspect?: number;
  /** Why the route map couldn't be drawn. */
  mapError?: string;
  sessionId?: string;
  generatedAt?: Date;
}

// Intel palette (sRGB) for print.
const CLASSIC_BLUE: [number, number, number] = [0, 84, 174];
const CORAL: [number, number, number] = [218, 46, 86];
const INK: [number, number, number] = [26, 26, 26];
const MUTED: [number, number, number] = [110, 110, 110];
const RULE: [number, number, number] = [210, 210, 210];

const PAGE_W = 210;
const PAGE_H = 297;
const M = 16;
const W = PAGE_W - 2 * M;

/** Lowest y body text may reach before a page break. */
const BOTTOM = PAGE_H - 18;
const TOP = 18;

/** jsPDF's built-in decoders; anything else must be converted first. */
function imgFormat(dataUrl: string) {
  if (/^data:image\/png/i.test(dataUrl)) return "PNG";
  if (/^data:image\/jpe?g/i.test(dataUrl)) return "JPEG";
  throw new Error(`unsupported image type ${dataUrl.slice(5, 20)}`);
}

/**
 * Incident PDF: header band, narrative, subject, route map, sightings table
 * with thumbnails (in time order), the subject's movement between cameras
 * with the elapsed time of each leg, observations and recommended actions.
 * Only sightings the operator confirmed appear; nothing is inferred beyond
 * them.
 */
export function buildReportPdf(input: ReportPdfInput): jsPDF {
  const { report, stops } = input;
  const at = input.generatedAt ?? new Date();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = 0;

  /** Start a new page unless `h` mm still fit; true when it did. */
  const ensure = (h: number) => {
    if (y + h <= BOTTOM) return false;
    doc.addPage();
    y = TOP;
    return true;
  };
  /** Image size that keeps its aspect ratio inside maxW x maxH. */
  const fit = (data: string, maxW: number, maxH: number) => {
    const p = doc.getImageProperties(data);
    const r = Math.min(maxW / p.width, maxH / p.height);
    return { w: p.width * r, h: p.height * r };
  };
  const heading = (text: string) => {
    ensure(12);
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...CLASSIC_BLUE);
    doc.text(text, M, y);
    y += 2;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(M, y, M + W, y);
    y += 5;
  };
  const paragraph = (text: string, size = 10, color = INK) => {
    if (!text.trim()) return;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(pdfProse(text).trim(), W) as string[];
    for (const line of lines) {
      ensure(5);
      doc.text(line, M, y);
      y += size * 0.45;
    }
    y += 1.5;
  };
  const bullets = (items: string[]) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.setFillColor(...INK);
    for (const item of items.map((i) => pdfProse(i).trim()).filter(Boolean)) {
      const lines = doc.splitTextToSize(
        item.replace(/^- /, ""),
        W - 5,
      ) as string[];
      lines.forEach((line, i) => {
        ensure(5);
        // A drawn dot: "•" is outside what the built-in font can encode.
        if (i === 0) doc.circle(M + 1.8, y - 1.2, 0.6, "F");
        doc.text(line, M + 5, y);
        y += 4.5;
      });
      y += 0.8;
    }
  };

  // Header band
  doc.setFillColor(...CLASSIC_BLUE);
  doc.rect(0, 0, PAGE_W, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Virtual Security Guard Agent", M, 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Incident report prepared with Argus and Intel VSS", M, 16);
  doc.text(`${PRESET_LABEL[report.preset]} report`, PAGE_W - M, 10, {
    align: "right",
  });
  doc.text(`${formatDateTime(at)}, ${formatClock(at)}`, PAGE_W - M, 16, {
    align: "right",
  });
  y = 34;

  // Title + meta
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  for (const line of doc.splitTextToSize(
    pdfProse(report.title),
    W,
  ) as string[]) {
    ensure(7);
    doc.text(line, M, y);
    y += 7;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const meta = [
    `Confidence: ${report.confidence}`,
    `${stops.length} verified sighting${stops.length === 1 ? "" : "s"}`,
    input.sessionId ? `Session ${input.sessionId}` : undefined,
  ].filter(Boolean);
  doc.text(toPdfText(meta.join("    ")), M, y);
  y += 6;

  heading("Summary");
  paragraph(report.summary || "No summary provided.");

  if (report.subject || input.subjectImage || input.subjectImageError) {
    heading("Subject");
    let imgW = 0;
    let imgBottom = y;
    if (input.subjectImage) {
      try {
        const size = fit(input.subjectImage, 34, 40);
        ensure(size.h + 2);
        doc.addImage(
          input.subjectImage,
          imgFormat(input.subjectImage),
          M,
          y - 2,
          size.w,
          size.h,
        );
        imgW = size.w;
        imgBottom = y - 2 + size.h;
      } catch (e) {
        paragraph(
          `The subject image could not be included (${(e as Error).message}).`,
          9,
          MUTED,
        );
      }
    } else if (input.subjectImageError)
      paragraph(
        `The subject image could not be included (${input.subjectImageError}).`,
        9,
        MUTED,
      );
    if (report.subject) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...INK);
      const tx = M + (imgW ? imgW + 4 : 0);
      const lines = doc.splitTextToSize(
        pdfProse(report.subject),
        M + W - tx,
      ) as string[];
      y += 2;
      for (const line of lines) {
        // Past the image's page the image no longer pushes the next section down.
        if (ensure(5)) imgBottom = y;
        doc.text(line, tx, y);
        y += 4.5;
      }
    }
    y = Math.max(y, imgBottom) + 2;
  }

  if (input.mapPng || input.mapError) {
    heading("Route");
    let mapError = input.mapError;
    if (input.mapPng) {
      try {
        // Fit by width and by a full page height, so a tall plan isn't clipped.
        const aspect = input.mapAspect ?? 0.62;
        const maxH = BOTTOM - TOP - 4;
        const h = Math.min(W * aspect, maxH);
        const w = h / aspect;
        ensure(h + 4);
        doc.addImage(input.mapPng, "PNG", M + (W - w) / 2, y, w, h);
        y += h + 4;
      } catch (e) {
        mapError = (e as Error).message;
      }
    }
    if (mapError)
      paragraph(
        `The route map could not be drawn (${mapError}); the sightings below are complete.`,
        9,
        MUTED,
      );
  }

  heading("Verified sightings, in time order");
  if (!stops.length) paragraph("No sightings were confirmed.", 10, MUTED);
  const noteFor = (s: TraceStop) =>
    report.timeline.find((t) => t.ref && hitMatchesRef(s.hit, t.ref))?.note;
  const numberOf = (s: TraceStop) =>
    input.numbers ? input.numbers.get(s.order) : s.order;
  const rowH = 16;
  const tx = M + 9;
  const cx = tx + 28;
  const textW = M + W - cx;
  stops.forEach((s) => {
    ensure(rowH + 2);
    const top = y;
    const n = numberOf(s);
    // Map marker number; a camera that isn't on the plan has none.
    doc.setFillColor(...(n ? CORAL : MUTED));
    doc.circle(M + 3, y + 3, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(n ? String(n) : "-", M + 3, y + 4.1, { align: "center" });
    const thumb = input.thumbs?.[s.order];
    if (thumb) {
      try {
        const size = fit(thumb, 24, 13.5);
        doc.addImage(
          thumb,
          imgFormat(thumb),
          tx + (24 - size.w) / 2,
          y,
          size.w,
          size.h,
        );
      } catch {
        // skip a bad frame
      }
    }
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    y += 3.5;
    for (const line of doc.splitTextToSize(
      `${s.at ? `${formatDay(s.at)}  ` : ""}${formatClock(s.at)}  ${cameraWithZone(s.hit)}`,
      textW,
    ) as string[]) {
      doc.text(line, cx, y);
      y += 4.2;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    for (const line of doc.splitTextToSize(
      toPdfText(
        `${s.hit.matchId}   segment ${formatOffset(s.hit.startS)} to ${formatOffset(s.hit.endS)}   relevance ${Math.round(s.hit.score * 100)}%`,
      ),
      textW,
    ) as string[]) {
      doc.text(line, cx, y - 0.2);
      y += 3.8;
    }
    const note = noteFor(s);
    let broke = false;
    if (note) {
      doc.setTextColor(...INK);
      for (const line of doc.splitTextToSize(
        pdfProse(note),
        textW,
      ) as string[]) {
        if (ensure(4)) broke = true;
        doc.text(line, cx, y);
        y += 3.8;
      }
    }
    y = broke ? y + 1 : Math.max(y + 1, top + rowH);
  });
  if (input.thumbLimit !== undefined && stops.length > input.thumbLimit)
    paragraph(
      `Thumbnails are shown for the first ${input.thumbLimit} sightings only.`,
      9,
      MUTED,
    );
  const extra = report.timeline.filter(
    (t) => !t.ref || !stops.some((s) => hitMatchesRef(s.hit, t.ref!)),
  );
  if (extra.length) {
    y += 2;
    bullets(extra.map((t) => (t.ref ? `${t.ref}: ${t.note}` : t.note)));
  }

  const legs = movementLegs(stops);
  if (legs.length) {
    heading("Movement");
    const camOf = (st: TraceStop) => cameraWithZone(st.hit);
    bullets(
      legs.map(
        (l) =>
          `${numberOf(l.from) ?? "-"} to ${numberOf(l.to) ?? "-"}: ${
            l.sameCamera
              ? `stayed on ${camOf(l.to)}`
              : `${camOf(l.from)} to ${camOf(l.to)}`
          }, ${formatGap(l.gapS)} (${formatClock(l.from.at)} to ${formatClock(l.to.at)}).`,
      ),
    );
    const first = stops[0].at;
    const last = stops[stops.length - 1].at;
    if (first && last)
      paragraph(
        `First seen ${formatDay(first)} ${formatClock(first)}; last seen ${formatDay(last)} ${formatClock(last)} (${formatGap((last.getTime() - first.getTime()) / 1000)} in total).`,
        9,
        MUTED,
      );
  }

  if (report.observations.length) {
    heading("Observations");
    bullets(report.observations);
  }
  if (report.actions.length) {
    heading("Recommended actions");
    bullets(report.actions);
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...RULE);
    doc.line(M, PAGE_H - 12, M + W, PAGE_H - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(
      "Sightings were confirmed by an operator. Times follow VSS ingest time. Describes clothing and movement only.",
      M,
      PAGE_H - 7,
    );
    doc.text(`${i} / ${pages}`, PAGE_W - M, PAGE_H - 7, { align: "right" });
  }
  return doc;
}
