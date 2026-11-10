// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  ChevronDown,
  FileText,
  Radio,
  RotateCcw,
  RotateCw,
  Square,
} from "lucide-react";
import { VsgMark } from "@/components/layout/VsgMark";
import { StatusChip } from "@/components/shared/media";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { VssHit } from "@/adapters/vss/types";
import type { ReportContent } from "@/features/reports/content";
import { formatClock, timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { SpatialMap } from "@/features/map/SpatialMap";
import { selectLiveCameraCount, useCamerasStore } from "@/stores/cameras";
import { useFloorplanStore } from "@/stores/floorplan";
import { useRoute } from "@/hooks/useRoute";
import { timelineLines, type TraceStop } from "@/stores/case";
import { useInvestigationStore } from "@/stores/investigation";
import {
  sessionSightings,
  useLiveTimelineStore,
  type LiveSighting,
} from "@/stores/liveTimeline";
import { useSettingsStore } from "@/stores/settings";
import { isWatchActive, useWatchStore, type WatchStatus } from "@/stores/watch";
import { ClipPlayerDialog } from "./ClipPlayerDialog";
import { LiveTimeline } from "./LiveTimeline";
import { useKnownTags } from "@/hooks/queries";

const ENDED: Partial<Record<WatchStatus, string>> = {
  stopped: "Live search ended",
  expired: "Live search ended: time limit reached",
  "idle-stopped": "Live search ended: no new matches for a while",
  error: "Live search failed",
};

const REPORTS = [
  { preset: "handover", label: "Handover report" },
  { preset: "escalation", label: "Escalation report" },
  { preset: "brief", label: "Short brief" },
] as const satisfies readonly {
  preset: ReportContent["preset"];
  label: string;
}[];

/**
 * A report request: one short line the operator sees, then the evidence Argus
 * needs (shown collapsed, see splitReportPrompt).
 */
function reportPrompt(label: string, stops: TraceStop[]): string {
  const n = stops.length;
  return [
    `Write a ${label.toLowerCase()} from the ${n} confirmed sighting${n === 1 ? "" : "s"}.`,
    `Report preset: ${label}. The sightings, in time order, with the subject's movement between cameras:`,
    timelineLines(stops).join("\n"),
  ].join("\n\n");
}

/**
 * The route of confirmed sightings, with the optional live camera search.
 * Shown once the session has a confirmed sighting or a live timeline. The live
 * search starts only from its button; while running it shows the live
 * timeline, refreshed every 10 seconds, and keeps it (read-only) afterwards.
 */
export function LiveTraceCard() {
  const w = useWatchStore();
  const busy = useInvestigationStore((s) => s.busy);
  const startWatch = useInvestigationStore((s) => s.startWatch);
  const send = useInvestigationStore((s) => s.send);
  const sessionId = useInvestigationStore((s) => s.sessionId);
  const sightings = useLiveTimelineStore((s) => sessionSightings(s, sessionId));
  const toggleConfirmed = useLiveTimelineStore((s) => s.toggleConfirmed);
  const liveCameras = useCamerasStore(selectLiveCameraCount);
  const watchMinutes = useSettingsStore((s) => s.watchMinutes);
  // The clip as opened: a better hit arriving later must not reload it.
  const [opened, setOpened] = useState<{ id: string; hit: VssHit }>();
  const [showTimeline, setShowTimeline] = useState(false);
  const [, tick] = useState(0);
  const [replay, setReplay] = useState(0);
  const plan = useFloorplanStore((s) => s.plan);
  const vssTags = useKnownTags();
  const active = isWatchActive(w);

  // Refresh the "started x ago" label while waiting for a first sighting.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [active]);

  // The route: every confirmed sighting, historical and live.
  const stops = useRoute();
  const playing = opened && sightings.find((x) => x.id === opened.id);
  const toggle = (x: LiveSighting) =>
    sessionId && toggleConfirmed(sessionId, x.id);

  if (!stops.length && !w.status && !sightings.length) return null;

  const label = w.subject?.imageUrl
    ? "the subject in the photo"
    : `"${w.subject?.query ?? "the subject"}"`;
  const added = sightings.filter((x) => x.confirmed).length;
  const ended = w.status && !active;
  const summary = `${sightings.length} sighting${sightings.length === 1 ? "" : "s"}, ${added} added to route`;

  return (
    <section
      aria-label="Confirmed route and live search"
      className="border bg-card"
      aria-live="polite"
    >
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        {w.subject?.previewUrl && (
          <img
            src={w.subject.previewUrl}
            alt="Subject"
            className="size-10 object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            Route
            <span className="font-normal text-muted-foreground">
              {stops.length} confirmed stop{stops.length === 1 ? "" : "s"}
            </span>
          </h3>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              disabled={!stops.length || busy || active}
              title={active ? "Stop the live search first" : undefined}
            >
              <FileText /> Generate report <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {REPORTS.map((r) => (
              <DropdownMenuItem
                key={r.preset}
                onSelect={() => void send(reportPrompt(r.label, stops))}
              >
                {r.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div className="relative">
        <SpatialMap
          plan={plan}
          vssTags={vssTags}
          stops={stops}
          replayKey={replay}
          labels="route"
          title="Subject route"
        />
        <div className="absolute top-2 right-2 flex gap-1">
          <Button
            size="xs"
            variant="outline"
            className="bg-background"
            onClick={() => setReplay((r) => r + 1)}
            disabled={!stops.length}
          >
            <RotateCcw /> Replay
          </Button>
          <Button size="xs" variant="outline" className="bg-background" asChild>
            <Link to="/floorplan">Open floorplan</Link>
          </Button>
        </div>
      </div>

      <div
        role="group"
        aria-label="Live camera search"
        className="flex flex-wrap items-center gap-3 border-t px-4 py-3"
      >
        <div className="min-w-0 flex-1 font-prose text-xs text-muted-foreground">
          {active ? (
            <p className="flex flex-wrap items-center gap-2">
              <VsgMark watching className="!size-5" />
              <StatusChip tone="success">
                <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
                {w.status === "starting" ? "Starting" : "Searching"}
              </StatusChip>
              Looking for {label} on the live cameras, refreshing every 10 s.
              {w.deadline && ` Stops at ${formatClock(new Date(w.deadline))}.`}
              {w.error && ` Last check failed: ${w.error}`}
            </p>
          ) : ended ? (
            <p className={w.status === "error" ? "text-destructive" : ""}>
              {ENDED[w.status!]}
              {w.status === "error" && w.error
                ? `: ${w.error}`
                : ` · ${summary}`}
            </p>
          ) : sightings.length ? (
            <p>Live search · {summary}</p>
          ) : liveCameras ? (
            <p>
              Watches the {liveCameras} live camera
              {liveCameras === 1 ? "" : "s"} for this subject for {watchMinutes}{" "}
              min.
            </p>
          ) : (
            <p>No live camera is connected, so live search is unavailable.</p>
          )}
        </div>
        {active ? (
          <Button size="sm" variant="destructive" onClick={() => void w.stop()}>
            <Square /> Stop live search
          </Button>
        ) : w.stopFailed ? (
          <Button size="sm" variant="outline" onClick={() => void w.stop()}>
            <RotateCw /> Retry stop
          </Button>
        ) : (
          liveCameras > 0 && (
            <Button
              size="sm"
              variant={ended ? "outline" : "default"}
              onClick={() => void startWatch()}
              disabled={busy}
            >
              <Radio />{" "}
              {ended || sightings.length
                ? "Search again"
                : "Start live camera search"}
            </Button>
          )
        )}
      </div>

      {!active && sightings.length > 0 && (
        <div className="px-4 pb-2">
          <Button
            size="xs"
            variant="ghost"
            aria-expanded={showTimeline}
            onClick={() => setShowTimeline((v) => !v)}
          >
            <ChevronDown className={cn(showTimeline && "rotate-180")} />
            {showTimeline ? "Hide timeline" : "Show timeline"}
          </Button>
        </div>
      )}
      {active && (
        <p className="px-4 pb-2 text-xs text-muted-foreground">
          {sightings.some((x) => x.watch === w.queryId)
            ? "Confirm live sightings to add them to the route."
            : `No live sightings yet${w.startedAt ? ` (started ${timeAgo(w.startedAt)})` : ""}. They appear here as the cameras see the subject.`}
        </p>
      )}
      {/* Mounted from Start, so every sighting of this watch counts as new. */}
      {(active || (showTimeline && sightings.length > 0)) && (
        <LiveTimeline
          sightings={sightings}
          watching={active ? w.queryId : undefined}
          onToggle={toggle}
          onPlay={(x) => setOpened({ id: x.id, hit: x.best })}
        />
      )}
      <ClipPlayerDialog
        hit={opened?.hit}
        onOpenChange={(o) => !o && setOpened(undefined)}
        verdict={playing?.confirmed ? "confirm" : undefined}
        onVerdict={
          playing && active && playing.watch === w.queryId
            ? () => toggle(playing)
            : undefined
        }
      />
    </section>
  );
}
