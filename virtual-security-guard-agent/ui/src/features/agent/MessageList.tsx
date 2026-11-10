// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useLayoutEffect, useRef, useState, Fragment } from "react";
import { ArrowDown, ImageUp, Search, ShieldCheck, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Turn } from "@/stores/investigation";
import { useRoute } from "@/hooks/useRoute";
import { useInvestigationStore } from "@/stores/investigation";
import { useWatchStore } from "@/stores/watch";
import { sessionSightings, useLiveTimelineStore } from "@/stores/liveTimeline";
import { LiveTraceCard } from "./LiveWatch";
import { AgentTurnView, ArgusAvatar, OperatorBubble } from "./Turns";

const SUGGESTIONS = [
  {
    icon: Search,
    title: "Find a person by description",
    prompt: "Search for a person in a blue jacket carrying a backpack.",
  },
  {
    icon: Timer,
    title: "Narrow it to a time window",
    prompt:
      "Find anyone loitering near the main entry between 14:00 and 15:00.",
  },
  {
    icon: ImageUp,
    title: "Search with a photo",
    prompt: "Find matches for this photo on every camera.",
    needsImage: true,
  },
];

function EmptyState({
  onPick,
  onAttachClick,
}: {
  onPick: (prompt: string) => void;
  onAttachClick: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 pt-[12vh] pb-8 text-center">
      <ArgusAvatar />
      <h2 className="mt-4 text-xl font-semibold">
        What should Argus look for?
      </h2>
      <p className="mt-2 max-w-md font-prose text-sm text-muted-foreground">
        Describe a person or drop a photo. Argus searches recorded footage
        across your cameras, you confirm the right sightings, and it traces
        their route on the floorplan.
      </p>
      <div className="mt-6 grid w-full gap-2 sm:grid-cols-3">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => {
              onPick(s.prompt);
              if (s.needsImage) onAttachClick();
            }}
            className="group flex flex-col items-start gap-2 border bg-card p-3 text-left transition-colors hover:border-brand-accent/50 hover:bg-accent"
          >
            <s.icon className="size-4 text-brand-accent" />
            <span className="text-sm font-medium">{s.title}</span>
            <span className="line-clamp-2 font-prose text-xs text-muted-foreground">
              {s.prompt}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" />
        Argus describes clothing and behaviour only. It never identifies people.
      </p>
    </div>
  );
}

interface Props {
  turns: Turn[];
  busy: boolean;
  onRetry: (agentTurnId: string) => void;
  onPick: (prompt: string) => void;
  onAttachClick: () => void;
}

/** Transcript with stick-to-bottom scrolling while Argus streams. */
export function MessageList({
  turns,
  busy,
  onRetry,
  onPick,
  onAttachClick,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const last = turns[turns.length - 1];
  // The route / live-search card sits under Argus's reply to the confirming
  // review, so later turns (such as a report) appear below it, not above.
  let fbIdx = -1;
  turns.forEach((t, i) => {
    if (t.role === "operator" && t.kind === "feedback") fbIdx = i;
  });
  const cardAfter = fbIdx >= 0 ? Math.min(fbIdx + 1, turns.length - 1) : -1;
  const lastLen =
    last?.role === "agent" ? last.text.length + last.tools.length : 0;

  // The route card grows below the transcript too: follow it while pinned.
  const routeLen = useRoute().length;
  const watchStatus = useWatchStore((s) => s.status);
  const sessionId = useInvestigationStore((s) => s.sessionId);
  const live = useLiveTimelineStore((s) => sessionSightings(s, sessionId));
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [turns.length, lastLen, pinned, routeLen, watchStatus, live]);

  // A new operator message always brings the view back to the bottom.
  useEffect(() => {
    if (last?.role === "operator") setPinned(true);
  }, [last]);

  if (!turns.length)
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        <EmptyState onPick={onPick} onAttachClick={onAttachClick} />
      </div>
    );

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        className="h-full overflow-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
      >
        <ol
          className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-6 pb-10"
          aria-label="Investigation transcript"
        >
          {turns.map((t, i) => (
            <Fragment key={t.id}>
              <li>
                {t.role === "operator" ? (
                  <OperatorBubble turn={t} />
                ) : (
                  <AgentTurnView
                    turn={t}
                    busy={busy}
                    // Only the latest streamed reply can be retried.
                    onRetry={
                      t === last && !t.replayed
                        ? () => onRetry(t.id)
                        : undefined
                    }
                  />
                )}
              </li>
              {i === cardAfter && (
                <li className="empty:hidden">
                  <LiveTraceCard />
                </li>
              )}
            </Fragment>
          ))}
          {cardAfter < 0 && (
            <li className="empty:hidden">
              <LiveTraceCard />
            </li>
          )}
        </ol>
      </div>
      {!pinned && (
        <Button
          size="icon-sm"
          variant="outline"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-background shadow"
          onClick={() => setPinned(true)}
          aria-label="Scroll to latest"
        >
          <ArrowDown />
        </Button>
      )}
    </div>
  );
}
