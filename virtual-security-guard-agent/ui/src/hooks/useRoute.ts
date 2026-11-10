// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useMemo, useRef } from "react";
import { hitKey } from "@/lib/hits";
import type { TraceStop } from "@/stores/case";
import { useInvestigationStore } from "@/stores/investigation";
import { routeOf } from "@/stores/investigation.logic";
import { sessionSightings, useLiveTimelineStore } from "@/stores/liveTimeline";

/**
 * The subject's route: every confirmed sighting of the session (review grids
 * and live), de-duplicated and in time order. Stable between renders.
 */
export function useRoute(): TraceStop[] {
  const turns = useInvestigationStore((s) => s.turns);
  const reviews = useInvestigationStore((s) => s.reviews);
  const sessionId = useInvestigationStore((s) => s.sessionId);
  const live = useLiveTimelineStore((s) => sessionSightings(s, sessionId));
  const prev = useRef<{ key: string; stops: TraceStop[] }>(undefined);
  return useMemo(() => {
    const stops = routeOf({ turns, reviews }, live);
    // Turns change on every streamed token; keep the same array (and so the
    // map animation) while the route itself is unchanged. A live sighting keeps
    // its identity while it grows, so the key covers its mutable fields too.
    const key = stops
      .map((s) =>
        [
          hitKey(s.hit),
          s.order,
          s.at?.getTime(),
          s.until?.getTime(),
          s.detections,
          s.hit.score,
          s.hit.seekS,
          s.hit.frame?.timestamp,
          s.hit.posterUrl,
        ].join(","),
      )
      .join("|");
    if (prev.current?.key !== key) prev.current = { key, stops };
    return prev.current.stops;
  }, [turns, reviews, live]);
}
