// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  CheckCheck,
  RotateCw,
  Square,
} from "lucide-react";
import { Markdown } from "@/components/shared/Markdown";
import { StatusChip } from "@/components/shared/media";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseAgentText, type Segment } from "@/protocol/parser";
import type { AgentTurn, OperatorTurn } from "@/stores/investigation";
import { ReportCard } from "./ReportCard";
import { ToolChip } from "./ToolChip";
import { ValidationGrid } from "./ValidationGrid";

export function ArgusAvatar({ working }: { working?: boolean }) {
  return (
    <div
      className={cn(
        "relative flex size-7 shrink-0 items-center justify-center bg-brand-accent text-white",
        working &&
          "after:absolute after:-inset-1 after:border after:border-brand-accent/50 motion-safe:after:animate-ping",
      )}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M2.5 12c2.4-4.2 5.6-6.3 9.5-6.3s7.1 2.1 9.5 6.3c-2.4 4.2-5.6 6.3-9.5 6.3S4.9 16.2 2.5 12Z" />
        <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
      </svg>
    </div>
  );
}

export function OperatorBubble({ turn }: { turn: OperatorTurn }) {
  if (turn.kind === "feedback")
    return (
      <div className="flex justify-end">
        <p className="flex max-w-[85%] items-start gap-2 border border-dashed bg-card px-3 py-2 font-prose text-sm text-muted-foreground">
          <CheckCheck className="mt-0.5 size-4 shrink-0 text-confirm" />
          <span>
            <span className="font-sans font-medium text-foreground">
              Review sent.{" "}
            </span>
            {turn.text}
          </span>
        </p>
      </div>
    );
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[85%] flex-col items-end gap-1.5">
        {turn.image && (
          <img
            src={turn.image.previewUrl}
            alt="Reference image"
            className="max-h-40 max-w-60 border object-cover"
          />
        )}
        <div className="bg-operator px-3.5 py-2.5 font-prose text-[0.9375rem] leading-relaxed whitespace-pre-wrap">
          {turn.text}
          {turn.details && (
            <details className="mt-1.5 text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Details</summary>
              <p className="mt-1 font-mono break-words">{turn.details}</p>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function Tools({ turn }: { turn: AgentTurn }) {
  const [open, setOpen] = useState(false);
  const running = turn.tools.filter((t) => t.status === "running");
  if (!turn.tools.length) return null;
  if (turn.tools.length <= 2 || turn.status === "streaming")
    return (
      <div className="flex flex-col items-start gap-1">
        {(turn.status === "streaming" && turn.tools.length > 3
          ? [...turn.tools.slice(-3)]
          : turn.tools
        ).map((t) => (
          <ToolChip key={t.id} tool={t} />
        ))}
        {running.length === 0 &&
          turn.status === "streaming" &&
          turn.tools.length > 3 && (
            <span className="text-xs text-muted-foreground">
              {turn.tools.length} tool calls so far
            </span>
          )}
      </div>
    );
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        Used {turn.tools.length} tools
      </button>
      {open && turn.tools.map((t) => <ToolChip key={t.id} tool={t} />)}
    </div>
  );
}

interface AgentTurnProps {
  turn: AgentTurn;
  busy: boolean;
  /** Omitted when this reply can't be retried (not the latest, or restored). */
  onRetry?: () => void;
}

function DirectiveView({
  seg,
  turn,
  reviewable,
}: {
  seg: Extract<Segment, { kind: "directive" }>;
  turn: AgentTurn;
  reviewable: boolean;
}) {
  const d = seg.directive;
  switch (d.type) {
    case "matches":
      return (
        <ValidationGrid
          data={d.data}
          turnId={turn.id}
          interactive={reviewable}
        />
      );
    case "report":
      return <ReportCard data={d.data} />;
    case "status":
      return d.data.message ? (
        <p className="text-xs text-muted-foreground">{d.data.message}</p>
      ) : null;
    default:
      return null;
  }
}

/** One Argus reply: tool activity, prose and rich cards for each directive. */
/** Operator-facing names of the blocks Argus writes. */
const FENCE_NAME: Record<string, string> = {
  "vsg-matches": "results",
  "vsg-report": "report",
  "vsg-status": "status",
};

export function AgentTurnView({ turn, busy, onRetry }: AgentTurnProps) {
  const streaming = turn.status === "streaming";
  const segments = useMemo(
    () => parseAgentText(turn.text, { streaming }),
    [turn.text, streaming],
  );
  const empty = !turn.text.trim();
  const runningTool = turn.tools.some((t) => t.status === "running");

  return (
    <div className="flex gap-3">
      <ArgusAvatar working={streaming} />
      <div className="min-w-0 flex-1 space-y-3 pt-0.5">
        <Tools turn={turn} />
        {turn.reasoning && streaming && empty && (
          <p className="line-clamp-2 font-prose text-xs text-muted-foreground italic">
            {turn.reasoning.slice(-240)}
          </p>
        )}
        {segments.map((seg, i) => {
          if (seg.kind === "text") return <Markdown key={i} text={seg.text} />;
          if (seg.kind === "pending")
            return (
              <StatusChip key={i} tone="info">
                <span className="size-1.5 rounded-full bg-brand-accent motion-safe:animate-pulse" />
                Preparing {seg.fence.replace("vsg-", "")}
              </StatusChip>
            );
          // The progress line is optional and cosmetic: hide a malformed one.
          if (seg.kind === "invalid" && seg.fence === "vsg-status") return null;
          if (seg.kind === "invalid")
            return (
              <details key={i} className="text-xs">
                <summary className="cursor-pointer">
                  <StatusChip tone="pending">
                    <AlertTriangle /> Argus's {FENCE_NAME[seg.fence] ?? "reply"}{" "}
                    couldn't be displayed
                  </StatusChip>
                  {!busy && onRetry && (
                    <Button
                      size="xs"
                      variant="outline"
                      className="ml-2"
                      onClick={onRetry}
                    >
                      <RotateCw /> Retry
                    </Button>
                  )}
                </summary>
                <pre className="mt-1 max-h-48 overflow-auto border bg-muted/50 p-2 font-mono text-[0.6875rem] whitespace-pre-wrap text-muted-foreground">
                  {seg.error}
                  {"\n\n"}
                  {seg.raw}
                </pre>
              </details>
            );
          return (
            <DirectiveView key={i} seg={seg} turn={turn} reviewable={!busy} />
          );
        })}
        {streaming && empty && !runningTool && (
          <p
            className="flex items-center gap-1 text-sm text-muted-foreground"
            aria-live="polite"
          >
            Argus is thinking
            <span className="inline-flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1 rounded-full bg-current motion-safe:animate-bounce"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </span>
          </p>
        )}
        {turn.status === "cancelled" && (
          <StatusChip tone="neutral">
            <Square /> Stopped by operator
          </StatusChip>
        )}
        {turn.status === "failed" && (
          <div className="status-error flex items-center gap-3 border border-[var(--status-border)] bg-[var(--status-bg)] px-3 py-2 text-sm text-[var(--status-fg)]">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="flex-1">
              {turn.error ?? "Argus couldn't finish this step."}
            </span>
            {!busy && onRetry && (
              <Button size="xs" variant="outline" onClick={onRetry}>
                <RotateCw /> Retry
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
