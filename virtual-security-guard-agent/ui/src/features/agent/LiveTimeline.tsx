// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { HitThumb } from "@/components/shared/media";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useCameraLocation } from "@/stores/floorplan";
import { SIGHTING_GAP_MS, type LiveSighting } from "@/stores/liveTimeline";

/** Sightings shown before "Show older". */
const PAGE = 50;

interface Props {
  sightings: readonly LiveSighting[];
  /** Query id of the running watch; its sightings can be confirmed. */
  watching?: string;
  onToggle: (s: LiveSighting) => void;
  onPlay: (s: LiveSighting) => void;
}

/**
 * Live sightings, newest first. A sighting that appears while the list is
 * shown is highlighted for a few seconds, and a growing one flashes its
 * detection count; rows never re-sort, so the list stays readable as it updates.
 */
export function LiveTimeline({ sightings, watching, onToggle, onPlay }: Props) {
  const [limit, setLimit] = useState(PAGE);
  // Sightings already there on first render are not "new".
  const [initial] = useState(() => new Set(sightings.map((s) => s.id)));
  const ordered = useMemo(
    () =>
      sightings
        .slice()
        .sort((a, b) => Date.parse(b.start) - Date.parse(a.start)),
    [sightings],
  );
  // Compare VSS times with each other: a sighting is still open while the
  // watch's latest detection is within the grouping gap of its end.
  const latest = useMemo(
    () =>
      Math.max(
        ...sightings
          .filter((s) => s.watch === watching)
          .map((s) => Date.parse(s.end)),
      ),
    [sightings, watching],
  );

  return (
    <>
      <ol
        aria-label="Live sightings"
        className="divide-y border-y empty:hidden"
      >
        {ordered.slice(0, limit).map((s) => (
          <Row
            key={s.id}
            s={s}
            isNew={!initial.has(s.id)}
            live={s.watch === watching}
            open={
              s.watch === watching &&
              latest - Date.parse(s.end) <= SIGHTING_GAP_MS
            }
            onToggle={() => onToggle(s)}
            onPlay={() => onPlay(s)}
          />
        ))}
      </ol>
      {ordered.length > limit && (
        <div className="flex justify-center py-2">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setLimit((n) => n + PAGE)}
          >
            Show older ({ordered.length - limit})
          </Button>
        </div>
      )}
    </>
  );
}

function Row({
  s,
  isNew,
  live,
  open,
  onToggle,
  onPlay,
}: {
  s: LiveSighting;
  isNew: boolean;
  /** Found by the running watch: can be confirmed, and its end may grow. */
  live: boolean;
  open: boolean;
  onToggle: () => void;
  onPlay: () => void;
}) {
  const zone = useCameraLocation(s.best.cameraTag);
  const start = formatClock(new Date(s.start));
  return (
    <li
      aria-label={`Live sighting on ${s.camera} at ${start}`}
      className={cn("flex items-center gap-3 px-4 py-2", isNew && "vsg-new")}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Play sighting on ${s.camera}`}
        className="w-24 shrink-0"
      >
        <HitThumb hit={s.best} alt={`Live frame from ${s.camera}`} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm">
          <span className="truncate font-mono">{s.camera}</span>
          {isNew && (
            <span className="vsg-fade-out bg-brand-accent px-1.5 text-[0.625rem] font-semibold text-white uppercase">
              New
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {start} –{" "}
          {open ? (
            <span className="inline-flex items-center gap-1 text-confirm">
              <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
              now
            </span>
          ) : (
            formatClock(new Date(s.end))
          )}
          {zone && ` · ${zone}`} ·{" "}
          <span key={s.count} className={cn(live && "vsg-flash")}>
            {s.count} detection{s.count === 1 ? "" : "s"}
          </span>
        </p>
      </div>
      {live ? (
        <Button
          size="sm"
          variant={s.confirmed ? "default" : "outline"}
          onClick={onToggle}
          aria-pressed={s.confirmed}
        >
          <Check /> {s.confirmed ? "Confirmed" : "Confirm"}
        </Button>
      ) : (
        s.confirmed && (
          <span className="flex items-center gap-1 text-xs text-confirm">
            <Check className="size-3.5" /> On route
          </span>
        )
      )}
    </li>
  );
}
