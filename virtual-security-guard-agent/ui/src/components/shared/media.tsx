// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { ImageOff } from "lucide-react";
import type { VssHit } from "@/adapters/vss/types";
import { useThumbnail } from "@/hooks/useThumbnail";
import { cn } from "@/lib/utils";

/** 16:9 frame for a sighting with a scan-sweep while the frame is grabbed. */
export function HitThumb({
  hit,
  className,
  children,
  alt,
}: {
  hit: Pick<VssHit, "posterUrl" | "playbackUrl" | "seekS">;
  className?: string;
  children?: React.ReactNode;
  alt: string;
}) {
  const { thumb, onImageError } = useThumbnail(hit);
  return (
    <div
      className={cn(
        "relative aspect-video overflow-hidden bg-[var(--carbon-shade-2)]",
        className,
      )}
    >
      {thumb.status === "ready" && (
        <img
          src={thumb.src}
          alt={alt}
          className="absolute inset-0 size-full object-cover"
          draggable={false}
          onError={onImageError}
        />
      )}
      {thumb.status === "loading" && (
        <div
          className="absolute inset-0 overflow-hidden"
          aria-label="Loading frame"
        >
          <div className="vsg-sweep absolute inset-x-0 h-1/4 bg-gradient-to-b from-transparent via-[var(--energy-blue)]/25 to-transparent" />
        </div>
      )}
      {thumb.status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs text-white/60">
          <ImageOff className="size-5" />
          Frame unavailable
        </div>
      )}
      {children}
    </div>
  );
}

/** Thin relevance bar; `min` marks the review cut-off. */
export function ScoreMeter({
  score,
  min,
  className,
}: {
  score: number;
  min?: number;
  className?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const below = min !== undefined && score < min;
  return (
    <div
      className={cn("flex items-center gap-2", className)}
      title={`Relevance ${pct}%`}
    >
      <div className="relative h-1 w-14 bg-white/25">
        <div
          className={cn(
            "absolute inset-y-0 left-0",
            below ? "bg-white/60" : "bg-[var(--energy-blue)]",
          )}
          style={{ width: `${pct}%` }}
        />
        {min !== undefined && (
          <div
            className="absolute -top-0.5 h-2 w-px bg-white/80"
            style={{ left: `${min * 100}%` }}
          />
        )}
      </div>
      <span className="font-prose text-[0.6875rem] tabular-nums">{pct}%</span>
    </div>
  );
}

// Literal class names so Tailwind generates every status utility; a
// template like `status-${tone}` is invisible to its source scanner.
const STATUS_TONE = {
  info: "status-info",
  success: "status-success",
  error: "status-error",
  pending: "status-pending",
  neutral: "status-neutral",
} as const;

export function StatusChip({
  tone,
  children,
  className,
}: {
  tone: keyof typeof STATUS_TONE;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        STATUS_TONE[tone],
        "inline-flex items-center gap-1 whitespace-nowrap rounded-sm border border-[var(--status-border)] bg-[var(--status-bg)] px-1.5 py-px text-xs font-medium text-[var(--status-fg)] [&>svg]:size-3",
        className,
      )}
    >
      {children}
    </span>
  );
}
