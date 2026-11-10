// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { TraceStop } from "@/stores/case";
import type { Floorplan } from "./schema";
import { planCamera } from "./tags";

/** One stop on the drawn route: a run of consecutive sightings on the same camera. */
export interface MapVisit {
  /** 1-based number drawn in the marker. */
  index: number;
  /** VSS tag, which is also the plan camera key. */
  tag: string;
  x: number;
  y: number;
  /** Marker position; offset from the node when the camera is revisited. */
  mx: number;
  my: number;
  /** Trace stop orders folded into this visit. */
  orders: number[];
  firstAt?: Date;
}

export interface RouteLayout {
  visits: MapVisit[];
  /** Sightings whose camera tag is not placed on the floorplan. */
  offMap: TraceStop[];
}

/**
 * Map ordered trace stops onto floorplan nodes. Consecutive stops on the same
 * camera collapse into one visit; revisits get their marker nudged around the
 * node so numbers stay readable.
 */
export function layoutRoute(
  stops: TraceStop[],
  plan: Floorplan,
  nudge = 18,
): RouteLayout {
  const visits: MapVisit[] = [];
  const offMap: TraceStop[] = [];
  const seen = new Map<string, number>();
  // The visit the previous stop belongs to; an off-plan stop ends it.
  let last: MapVisit | undefined;
  for (const s of stops) {
    const tag = s.hit.cameraTag;
    const cam = tag ? planCamera(plan, tag) : undefined;
    if (!tag || !cam) {
      offMap.push(s);
      last = undefined;
      continue;
    }
    if (last && last.tag === tag) {
      last.orders.push(s.order);
      continue;
    }
    const n = seen.get(tag) ?? 0;
    seen.set(tag, n + 1);
    const angle = -Math.PI / 4 + n * (Math.PI / 2.5);
    last = {
      index: visits.length + 1,
      tag,
      x: cam.x,
      y: cam.y,
      mx: n ? cam.x + nudge * Math.cos(angle) : cam.x,
      my: n ? cam.y + nudge * Math.sin(angle) : cam.y,
      orders: [s.order],
      firstAt: s.at,
    };
    visits.push(last);
  }
  return { visits, offMap };
}

/**
 * The map marker number of each stop, by stop order, so lists and the PDF
 * number stops the way the map does. Stops on a camera that isn't on the
 * plan have no number.
 */
export function stopNumbers(
  stops: TraceStop[],
  plan: Floorplan,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const v of layoutRoute(stops, plan).visits)
    for (const order of v.orders) out.set(order, v.index);
  return out;
}
