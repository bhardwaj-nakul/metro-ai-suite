// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { Check, Play, Sparkles } from "lucide-react";
import type { VssHit } from "@/adapters/vss/types";
import { hitCameraLabel } from "@/lib/hits";
import { HitThumb, ScoreMeter } from "@/components/shared/media";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatClock, formatDateTime, hitTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { selectCameraByTag, useCamerasStore } from "@/stores/cameras";
import type { Verdict } from "@/stores/case";
import { useCameraLocation } from "@/stores/floorplan";

interface Props {
  hit: VssHit;
  verdict?: Verdict;
  /** Argus kept this one in its shortlist. */
  picked?: boolean;
  note?: string;
  minScore: number;
  readOnly?: boolean;
  onVerdict: (v: Verdict) => void;
  onPlay: () => void;
}

/** One potential match: timestamped frame, camera and the two review toggles. */
export function MatchCard({
  hit,
  verdict,
  picked,
  note,
  minScore,
  readOnly,
  onVerdict,
  onPlay,
}: Props) {
  const camera = useCamerasStore(selectCameraByTag(hit.cameraTag));
  const location = useCameraLocation(hit.cameraTag, camera?.location);
  const name = hitCameraLabel(hit);
  const at = hitTime(hit);
  const confirmed = verdict === "confirm";
  const rejected = verdict === "reject";

  return (
    <article
      className={cn(
        "group relative flex flex-col border bg-card transition-[opacity,box-shadow]",
        confirmed && "border-confirm ring-1 ring-confirm",
        rejected && "opacity-55",
      )}
      aria-label={`Match ${hit.matchId} on ${name}`}
    >
      <HitThumb
        hit={hit}
        alt={`Frame from ${name}`}
        className={cn(rejected && "grayscale")}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-1.5">
          <span className="bg-black/65 px-1.5 py-px font-mono text-[0.6875rem] text-white">
            {hit.matchId}
          </span>
          {picked && (
            <span className="inline-flex items-center gap-1 bg-[var(--energy-blue)] px-1.5 py-px text-[0.6875rem] font-medium text-[var(--classic-blue-shade-2)]">
              <Sparkles className="size-3" /> Argus pick
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onPlay}
          className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-opacity hover:bg-black/30 hover:opacity-100 focus-visible:bg-black/30 focus-visible:opacity-100"
          aria-label={`Play clip for ${hit.matchId}`}
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-black/60">
            <Play className="size-5 translate-x-px" />
          </span>
        </button>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6 text-white">
          <span className="font-mono text-xs tabular-nums">
            {formatClock(at)}
          </span>
          <ScoreMeter score={hit.score} min={minScore} />
        </div>
        {confirmed && (
          <span className="absolute right-1.5 bottom-8 flex size-6 items-center justify-center rounded-full bg-confirm text-white">
            <Check className="size-4" />
          </span>
        )}
      </HitThumb>

      <div className="flex flex-1 flex-col gap-0.5 px-2.5 pt-2 pb-2">
        <p className="truncate text-sm font-semibold" title={hit.cameraTag}>
          {name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {[location, at ? formatDateTime(at) : undefined]
            .filter(Boolean)
            .join(", ") || "Time unknown"}
        </p>
        {note && (
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="mt-0.5 line-clamp-2 font-prose text-xs text-foreground/80">
                {note}
              </p>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{note}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {!readOnly && (
        <button
          type="button"
          aria-pressed={confirmed}
          onClick={() => onVerdict("confirm")}
          className={cn(
            "flex items-center justify-center gap-1.5 border-t py-2 text-xs font-medium transition-colors",
            confirmed
              ? "bg-confirm text-white"
              : "text-foreground hover:bg-confirm-soft",
          )}
        >
          <Check className="size-3.5" /> {confirmed ? "Confirmed" : "Confirm"}
        </button>
      )}
      {readOnly && confirmed && (
        <div className="border-t bg-confirm-soft py-1.5 text-center text-xs font-medium text-confirm">
          Confirmed
        </div>
      )}
    </article>
  );
}
