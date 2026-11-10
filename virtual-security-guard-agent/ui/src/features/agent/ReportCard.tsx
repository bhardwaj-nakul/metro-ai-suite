// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { subjectImageOf } from "@/stores/investigation.logic";
import { useState } from "react";
import { Link } from "react-router";
import { Download, FileText, Loader2, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { StatusChip } from "@/components/shared/media";
import { Markdown } from "@/components/shared/Markdown";
import { Button } from "@/components/ui/button";
import {
  PRESET_LABEL,
  toReportContent,
  type ReportContent,
} from "@/features/reports/content";
import { ReportEditor } from "@/features/reports/ReportEditor";
import {
  downloadReport,
  useReportGenerator,
} from "@/features/reports/useReportGenerator";
import { cn } from "@/lib/utils";
import type { ReportDirective } from "@/protocol/directives";
import type { GeneratedReport } from "@/stores/reports";
import { useInvestigationStore } from "@/stores/investigation";
import { useRoute } from "@/hooks/useRoute";

const CONFIDENCE_TONE = {
  low: "pending",
  medium: "info",
  high: "success",
} as const;

/** Argus's draft incident report: preview, optional edits, then PDF. */
export function ReportCard({ data }: { data: ReportDirective }) {
  const [draft, setDraft] = useState<ReportContent>(() =>
    toReportContent(data),
  );
  const [editing, setEditing] = useState(false);
  const [done, setDone] = useState<GeneratedReport>();
  // Every sighting confirmed in this session (historical and live), in time order.
  const stops = useRoute();
  const subject = useInvestigationStore(
    (s) => subjectImageOf(s.turns)?.previewUrl,
  );
  const sessionId = useInvestigationStore((s) => s.sessionId);
  const { generate, busy, offscreen } = useReportGenerator();

  async function build() {
    const r = await generate({
      report: draft,
      stops,
      subjectImage: subject,
      sessionId,
    });
    setDone(r);
    return r;
  }

  async function onGenerate() {
    try {
      const r = await build();
      toast.success("Incident report ready", {
        description: r.fileName,
        action: { label: "Download", onClick: () => downloadReport(r) },
      });
    } catch (e) {
      toast.error("Couldn't build the PDF", {
        description: (e as Error).message,
      });
    }
  }

  return (
    <section className="border bg-card" aria-label="Incident report draft">
      <header className="flex items-start gap-3 border-b px-3 py-2.5">
        <FileText className="mt-0.5 size-4 shrink-0 text-brand-accent" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{draft.title}</h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <StatusChip tone="neutral">{PRESET_LABEL[draft.preset]}</StatusChip>
            <StatusChip tone={CONFIDENCE_TONE[draft.confidence]}>
              {draft.confidence} confidence
            </StatusChip>
            <StatusChip tone="neutral">
              {stops.length} sighting{stops.length === 1 ? "" : "s"}
            </StatusChip>
          </div>
        </div>
      </header>

      <div className="px-3 py-3">
        {editing ? (
          <ReportEditor value={draft} onChange={setDraft} stops={stops} />
        ) : (
          <div className="grid gap-2">
            <Markdown text={draft.summary || "No summary."} />
            {draft.subject && (
              <p className="font-prose text-sm text-muted-foreground">
                <span className="font-sans font-medium text-foreground">
                  Subject.{" "}
                </span>
                {draft.subject}
              </p>
            )}
            {draft.actions.length > 0 && (
              <div className="font-prose text-sm">
                <p className="font-sans font-medium">Recommended actions</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {draft.actions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditing((e) => !e)}
          className={cn(editing && "bg-accent")}
          aria-pressed={editing}
        >
          <PencilLine /> {editing ? "Done editing" : "Edit before export"}
        </Button>
        <span className="flex-1" />
        {done && (
          <>
            <Button size="sm" variant="ghost" asChild>
              <Link to="/reports">All reports</Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => downloadReport(done)}
            >
              <Download /> Download
            </Button>
          </>
        )}
        <Button
          size="sm"
          onClick={onGenerate}
          disabled={busy || !draft.title.trim()}
        >
          {busy ? <Loader2 className="animate-spin" /> : <FileText />}
          {done ? "Regenerate PDF" : "Generate PDF"}
        </Button>
      </footer>
      {offscreen}
    </section>
  );
}
