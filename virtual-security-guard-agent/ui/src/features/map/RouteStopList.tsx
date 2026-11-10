// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { hitCameraLabel } from "@/lib/hits";
import { formatClock } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { TraceStop } from "@/stores/case";
import { useFloorplanStore } from "@/stores/floorplan";
import { useMemo } from "react";
import { stopNumbers } from "./route";

interface Props {
  stops: TraceStop[];
  /** Show at most this many stops, then "and N more". */
  max?: number;
  size?: "sm" | "md";
}

/**
 * Route stops with the map's marker number, time and camera. Consecutive
 * stops on one camera share a number; a camera not on the plan shows "–".
 */
export function RouteStopList({ stops, max, size = "md" }: Props) {
  const plan = useFloorplanStore((s) => s.plan);
  const numbers = useMemo(() => stopNumbers(stops, plan), [stops, plan]);
  const shown = max ? stops.slice(0, max) : stops;
  const sm = size === "sm";
  return (
    <ol className={cn("grid", sm ? "gap-1 text-xs" : "gap-1.5 text-sm")}>
      {shown.map((s) => {
        const n = numbers.get(s.order);
        return (
          <li key={s.order + s.hit.matchId} className="flex items-center gap-2">
            <span
              title={n ? undefined : "Camera not on the floorplan"}
              className={cn(
                "flex shrink-0 items-center justify-center rounded-full font-bold",
                n ? "bg-track text-white" : "bg-muted text-muted-foreground",
                sm ? "size-4 text-[0.625rem]" : "size-5 text-[0.6875rem]",
              )}
            >
              {n ?? "–"}
            </span>
            <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
              {formatClock(s.at)}
            </span>
            <span className="truncate font-mono">{hitCameraLabel(s.hit)}</span>
          </li>
        );
      })}
      {stops.length > shown.length && (
        <li className="text-muted-foreground">
          and {stops.length - shown.length} more
        </li>
      )}
    </ol>
  );
}
