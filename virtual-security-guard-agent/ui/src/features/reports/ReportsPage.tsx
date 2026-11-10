// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQueries } from "@tanstack/react-query";
import { Download, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getAdapters } from "@/adapters";
import type { HermesMessage, HermesSession } from "@/adapters/hermes/types";
import { Button } from "@/components/ui/button";
import { qk, useInvestigations } from "@/hooks/queries";
import {
  latestDirective,
  reviewsFromTurns,
  routeOf,
  subjectImageOf,
  turnsFromMessages,
} from "@/stores/investigation.logic";
import { sessionSightings, useLiveTimelineStore } from "@/stores/liveTimeline";
import { toReportContent } from "./content";
import { downloadReport, useReportGenerator } from "./useReportGenerator";

/** An investigation's latest report draft and what its PDF is built from. */
function reportOf(session: HermesSession, messages: HermesMessage[]) {
  const turns = turnsFromMessages(messages);
  const found = latestDirective(turns, "report");
  if (!found) return undefined;
  const live = sessionSightings(useLiveTimelineStore.getState(), session.id);
  return {
    session,
    report: toReportContent(found.directive.data),
    stops: routeOf({ turns, reviews: reviewsFromTurns(turns) }, live),
    subjectImage: subjectImageOf(turns)?.previewUrl,
  };
}

const NO_SESSIONS: HermesSession[] = [];

/** Transcript query results, combined (and structurally shared) for memos. */
function combineTranscripts(
  results: {
    data?: HermesMessage[];
    isPending: boolean;
    error: Error | null;
  }[],
) {
  return {
    data: results.map((t) => t.data),
    pending: results.some((t) => t.isPending),
    error: results.find((t) => t.error)?.error,
  };
}

/** Incident reports: the latest report of each past investigation in Hermes. */
export function ReportsPage() {
  const navigate = useNavigate();
  const sessions = useInvestigations();
  const list = sessions.data ?? NO_SESSIONS;
  // Keyed by lastActive: a transcript is read again only when it changed.
  const transcripts = useQueries({
    queries: list.map((s) => ({
      queryKey: [...qk.messages(s.id), s.lastActive],
      queryFn: () => getAdapters().hermes.getMessages(s.id),
      staleTime: Infinity,
    })),
    combine: combineTranscripts,
  });
  const reports = useMemo(
    () =>
      list.flatMap((s, i) => {
        const messages = transcripts.data[i];
        const r = messages && reportOf(s, messages);
        return r ? [r] : [];
      }),
    [list, transcripts.data],
  );
  const loading =
    sessions.isLoading || sessions.isFetchingNextPage || transcripts.pending;
  const failed = sessions.error ?? transcripts.error;

  const { generate, offscreen } = useReportGenerator();
  const [building, setBuilding] = useState<string>();
  async function download(r: NonNullable<ReturnType<typeof reportOf>>) {
    setBuilding(r.session.id);
    try {
      downloadReport(await generate({ ...r, sessionId: r.session.id }));
    } catch (e) {
      toast.error("Couldn't build the PDF", {
        description: (e as Error).message,
      });
    } finally {
      setBuilding(undefined);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 p-4 md:p-6">
      <div>
        <h2 className="text-lg font-semibold">Incident reports</h2>
        <p className="text-sm text-muted-foreground">
          Reports are drafted by Argus, reviewed by you and exported as PDF in
          the browser.
        </p>
      </div>
      <section className="border bg-card">
        {reports.length > 0 && (
          <ul className="divide-y">
            {reports.map((r) => (
              <li
                key={r.session.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
              >
                <FileText className="size-4 shrink-0 text-brand-accent" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {r.report.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.session.title || "Untitled"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!!building}
                  onClick={() => void download(r)}
                >
                  {building === r.session.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Download />
                  )}
                  Download PDF
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    navigate(
                      `/argus?session=${encodeURIComponent(r.session.id)}`,
                    )
                  }
                >
                  Open in Argus
                </Button>
              </li>
            ))}
          </ul>
        )}
        {failed ? (
          <p className="px-4 py-8 text-center text-sm text-destructive">
            Couldn't reach Hermes: {failed.message}
          </p>
        ) : loading ? (
          <p className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading reports
          </p>
        ) : (
          !reports.length && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No reports yet. Ask Argus for a report after tracing a subject.
            </p>
          )
        )}
        {sessions.hasNextPage && !loading && (
          <div className="flex items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
            Checked {list.length} investigations.
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void sessions.fetchNextPage()}
            >
              Load older
            </Button>
          </div>
        )}
      </section>
      {offscreen}
    </div>
  );
}
