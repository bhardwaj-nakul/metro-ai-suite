// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ImagePlus,
  Loader2,
  MessageSquare,
  RotateCw,
  SendHorizontal,
} from "lucide-react";
import type { VssHit } from "@/adapters/vss/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { hitKey, noteForHit, resolveRefs, scoreCutoff } from "@/lib/hits";
import type { MatchesDirective } from "@/protocol/directives";
import { IMAGE_ONLY_PROMPT } from "@/protocol/feedback";
import { useRoute } from "@/hooks/useRoute";
import { splitVerdicts, type Verdict } from "@/stores/case";
import { editableGridId, useInvestigationStore } from "@/stores/investigation";
import { useSettingsStore } from "@/stores/settings";
import { ClipPlayerDialog } from "./ClipPlayerDialog";
import { ATTACH_INPUT_ID, PROMPT_ID } from "./Composer";
import { MatchCard } from "./MatchCard";
import { useDirectiveHits } from "./useDirectiveHits";
import { useSubmitReview } from "./useSubmitReview";

const EMPTY: Record<string, Verdict> = {};

interface Props {
  data: MatchesDirective;
  /** Agent turn that emitted the grid; keys its review. */
  turnId: string;
  /** False while Argus is busy: verdicts can still change, sending waits. */
  interactive: boolean;
}

/** Matches shown at first (a 3×2 grid on wide screens). */
const PAGE = 6;
/** Most findings a grid can reveal with "Show more". */
const MAX_FINDINGS = 20;

/**
 * Human-in-the-loop review of Argus's potential matches: the top six, with
 * "Show more findings" revealing up to twenty. The operator only confirms;
 * every shown match left unconfirmed is sent as a false positive. A grid can
 * be reviewed once, and only while it is the last turn; after that it shows
 * what was sent. Sightings
 * confirmed in any grid form the time-ordered route and the report.
 */
export function ValidationGrid({ data, turnId, interactive }: Props) {
  const { hits, queryId, unreadable, isLoading, error, retry } =
    useDirectiveHits(turnId);
  const minScore = useSettingsStore((s) => s.minTraceScore);
  const send = useInvestigationStore((s) => s.send);
  const editable = useInvestigationStore((s) => editableGridId(s) === turnId);
  const review = useInvestigationStore((s) => s.reviews[turnId]);
  const setVerdicts = useInvestigationStore((s) => s.setVerdicts);
  const sent = review?.sent;
  const route = useRoute();
  const [playing, setPlaying] = useState<VssHit>();
  // Only hits at or above the operator's cut-off (relative to the peak score).
  const cutoff = useMemo(() => scoreCutoff(hits, minScore), [hits, minScore]);
  const eligible = useMemo(
    () => hits.filter((h) => h.score >= cutoff),
    [hits, cutoff],
  );
  const total = Math.min(eligible.length, MAX_FINDINGS);
  // A grid that was already reviewed reopens with everything it showed.
  const [visible, setVisible] = useState(PAGE);
  const [noMatch, setNoMatch] = useState(false);
  const sentCount = sent ? Object.keys(sent).length : 0;
  const count = Math.min(total, Math.max(visible, sentCount));
  const shown = useMemo(() => eligible.slice(0, count), [eligible, count]);
  // A badge on every card says nothing, so it only marks a subset.
  const picks = useMemo(() => {
    const p = resolveRefs(data.keep, hits) ?? new Set<string>();
    return eligible.every((h) => p.has(h.matchId)) ? new Set<string>() : p;
  }, [data.keep, hits, eligible]);
  const { submit, sending } = useSubmitReview(turnId, queryId, hits);

  // An unreviewed grid starts with the sightings already on the route.
  const verdicts = useMemo(() => {
    if (!editable) return sent ?? EMPTY;
    if (review) return review.verdicts;
    const onRoute = new Set(route.map((s) => hitKey(s.hit)));
    const out: Record<string, Verdict> = {};
    for (const h of hits)
      if (onRoute.has(hitKey(h))) out[h.matchId] = "confirm";
    return out;
  }, [editable, sent, review, route, hits]);
  const verdictFor = (h: VssHit): Verdict | undefined => verdicts[h.matchId];

  /** What saving would send: shown + unconfirmed = false positive. */
  const next = useMemo(() => {
    const out: Record<string, Verdict> = {};
    for (const h of shown)
      out[h.matchId] = verdicts[h.matchId] === "confirm" ? "confirm" : "reject";
    return out;
  }, [shown, verdicts]);
  const confirmed = splitVerdicts(next).confirm.length;

  /** A frame was cropped and stored in VSS: search the footage for it. */
  function onCrop(image: { previewUrl: string; imageUrl: string }) {
    const search = () => void send(IMAGE_ONLY_PROMPT, { image });
    // A run is streaming: the search can't start now, so let the operator
    // start it once Argus is done instead of dropping it.
    if (useInvestigationStore.getState().busy) {
      toast.warning("Cropped person saved, but Argus is busy", {
        description: "Search with the crop when Argus finishes.",
        duration: Infinity,
        action: {
          label: "Search now",
          onClick: () =>
            useInvestigationStore.getState().busy ? onCrop(image) : search(),
        },
      });
      return;
    }
    toast.success("Cropped person saved to VSS", {
      description: "Searching the footage for that person…",
    });
    search();
  }

  /** Nothing confirmed yet and some matches are still hidden: show them first. */
  const revealFirst = confirmed === 0 && total > shown.length;

  function save() {
    if (revealFirst) {
      setVisible(total);
      return;
    }
    if (confirmed === 0) {
      // Nothing matches: nothing is sent; the operator retries from the composer.
      setNoMatch(true);
      return;
    }
    setNoMatch(false);
    void submit(next);
  }

  function onVerdict(h: VssHit) {
    const out = { ...verdicts };
    if (out[h.matchId] === "confirm") delete out[h.matchId];
    else out[h.matchId] = "confirm";
    setVerdicts(turnId, out);
  }

  if (isLoading)
    return (
      <section className="border bg-card p-3" aria-busy>
        <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading potential matches
          from the search result
        </p>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {Array.from({ length: PAGE }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/3.6] rounded-none" />
          ))}
        </div>
      </section>
    );

  if (error)
    return (
      <section className="status-error flex items-center gap-3 border border-[var(--status-border)] bg-[var(--status-bg)] p-3 text-sm text-[var(--status-fg)]">
        <AlertTriangle className="size-4 shrink-0" />
        <span className="flex-1">
          Couldn't read the search results from the transcript: {error}
        </span>
        <Button size="sm" variant="outline" onClick={retry}>
          <RotateCw /> Retry
        </Button>
      </section>
    );

  if (!shown.length)
    return (
      <section className="border border-dashed bg-card p-4 text-sm text-muted-foreground">
        {unreadable
          ? unreadableText(unreadable)
          : "VSS returned no sightings for this search. Try a wider time window, more cameras or a different description."}
      </section>
    );

  return (
    <section className="border bg-card" aria-label="Potential matches">
      <header className="flex items-center gap-3 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">
            {shown.length} potential match{shown.length === 1 ? "" : "es"}
            {total > shown.length && (
              <span className="font-normal text-muted-foreground">
                {" "}
                (top {shown.length} of {total})
              </span>
            )}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {editable
              ? "Confirm the sightings that show the subject. Unconfirmed ones count as false positives."
              : sent
                ? "Review sent to Argus."
                : "Earlier search. Only the latest results can be reviewed."}
          </p>
        </div>
        {queryId && (
          <span className="font-mono text-[0.6875rem] text-muted-foreground">
            {queryId}
          </span>
        )}
      </header>

      <div className="grid grid-cols-2 gap-2.5 p-3 sm:grid-cols-3">
        {shown.map((h) => (
          <MatchCard
            key={h.matchId}
            hit={h}
            verdict={verdictFor(h)}
            picked={picks.has(h.matchId)}
            note={noteForHit(data.notes, h)}
            minScore={cutoff}
            readOnly={!editable}
            onVerdict={() => onVerdict(h)}
            onPlay={() => setPlaying(h)}
          />
        ))}
      </div>

      {unreadable > 0 && (
        <p className="px-3 pb-2 text-xs text-muted-foreground">
          {unreadableText(unreadable)}
        </p>
      )}

      {total > shown.length && (
        <div className="flex justify-center px-3 pb-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setVisible(Math.min(total, count + PAGE))}
          >
            <ChevronDown /> Show {Math.min(PAGE, total - shown.length)} more
            finding
            {Math.min(PAGE, total - shown.length) === 1 ? "" : "s"} (
            {shown.length} of {total} shown)
          </Button>
        </div>
      )}

      {editable && (
        <footer className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-card/95 px-3 py-2.5 backdrop-blur">
          {!(noMatch && confirmed === 0) && (
            <p
              className="shrink-0 text-xs whitespace-nowrap text-muted-foreground"
              aria-live="polite"
            >
              <span className="font-semibold text-confirm">
                {confirmed} confirmed
              </span>{" "}
              of {shown.length}
              {route.length > 0 && (
                <span> · {route.length} in this session</span>
              )}
            </p>
          )}
          {noMatch && confirmed === 0 ? (
            <div
              role="status"
              className="flex flex-1 flex-wrap items-center gap-2 text-xs"
            >
              <span className="min-w-48 flex-1 text-muted-foreground">
                None match. Describe clothing, cameras or a time range, or try
                another photo.
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  document.getElementById(ATTACH_INPUT_ID)?.click()
                }
              >
                <ImagePlus /> Try another photo
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => document.getElementById(PROMPT_ID)?.focus()}
              >
                <MessageSquare /> Refine in chat
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant={confirmed ? "default" : "outline"}
              className="ml-auto shrink-0 whitespace-nowrap"
              disabled={sending || !interactive}
              title={
                !interactive
                  ? "Argus is busy; send when it finishes"
                  : undefined
              }
              onClick={save}
            >
              {sending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <SendHorizontal />
              )}
              {confirmed
                ? `Save ${confirmed} confirmed`
                : revealFirst
                  ? `None match, show ${total - shown.length} more`
                  : "None match"}
            </Button>
          )}
        </footer>
      )}

      <ClipPlayerDialog
        hit={playing}
        onOpenChange={(o) => !o && setPlaying(undefined)}
        verdict={playing ? verdictFor(playing) : undefined}
        onVerdict={playing && editable ? () => onVerdict(playing) : undefined}
        onCropSearch={onCrop}
      />
    </section>
  );
}

const unreadableText = (n: number) =>
  `${n} result${n === 1 ? "" : "s"} couldn't be read.`;
