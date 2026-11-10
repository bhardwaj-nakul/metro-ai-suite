// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { VssHit } from "@/adapters/vss/types";
import { hitCameraLabel, hitKey, segmentKey } from "@/lib/hits";
import { formatGap, hitTime } from "@/lib/time";
import { cameraZone } from "./floorplan";

export type Verdict = "confirm" | "reject";

/** One review grid's state, keyed by the agent turn that showed it. */
export interface Review {
  /** The operator's working verdicts (only confirms; unconfirmed = reject). */
  verdicts: Record<string, Verdict>;
  /** The verdicts last sent to Argus (absent = never sent). */
  sent?: Record<string, Verdict>;
}

/** The part of a turn the route needs: its id and grounded search hits. */
interface GridTurn {
  id: string;
  role: string;
  search?: { hits: VssHit[] };
}

/**
 * Every sighting the operator confirmed in this session: the sent verdicts of
 * each review grid in turn order (a later grid's verdict on the same VSS
 * segment wins), plus confirmed live sightings. One per segment, in time order.
 */
export function confirmedSightings(
  turns: readonly GridTurn[],
  reviews: Record<string, Review>,
  live: readonly VssHit[] = [],
): VssHit[] {
  const bySegment = new Map<string, { hit: VssHit; confirmed: boolean }>();
  for (const t of turns) {
    const sent = reviews[t.id]?.sent;
    if (t.role !== "agent" || !sent || !t.search) continue;
    for (const h of t.search.hits) {
      const v = sent[h.matchId];
      if (v) bySegment.set(hitKey(h), { hit: h, confirmed: v === "confirm" });
    }
  }
  for (const h of live) bySegment.set(hitKey(h), { hit: h, confirmed: true });
  return sortByTime(
    [...bySegment.values()].filter((x) => x.confirmed).map((x) => x.hit),
  );
}

/** Route stops from time-ordered sightings, numbered from 1. */
export function routeFromSightings(hits: VssHit[]): TraceStop[] {
  return sortByTime(hits).map((hit, i) => ({
    hit,
    at: hitTime(hit),
    order: i + 1,
  }));
}

/** Order hits by when they happened (unknown times last, then by rank). */
export function sortByTime(hits: VssHit[]): VssHit[] {
  const t = (h: VssHit) => hitTime(h)?.getTime() ?? Number.POSITIVE_INFINITY;
  return hits.slice().sort((a, b) => t(a) - t(b) || a.rank - b.rank);
}

export function splitVerdicts(v: Record<string, Verdict> | undefined) {
  const confirm: string[] = [];
  const reject: string[] = [];
  for (const [id, verdict] of Object.entries(v ?? {}))
    (verdict === "confirm" ? confirm : reject).push(id);
  const byRank = (a: string, b: string) =>
    Number(a.slice(1)) - Number(b.slice(1));
  return { confirm: confirm.sort(byRank), reject: reject.sort(byRank) };
}

export interface TraceStop {
  hit: VssHit;
  /** 1-based position on the route. */
  order: number;
  /** Ingest time + segment start (see Q7: ingest-time ordering). */
  at?: Date;
  /** A live sighting's last detection, when it spans more than one. */
  until?: Date;
  /** Detections folded into a live sighting. */
  detections?: number;
}

/** The subject's move between two consecutive stops on the route. */
export interface MovementLeg {
  from: TraceStop;
  to: TraceStop;
  /** Seconds between the two sightings, when both times are known. */
  gapS?: number;
  /** Seen again on the same camera rather than a move between cameras. */
  sameCamera: boolean;
}

/** Legs between consecutive stops of a time-ordered route. */
export function movementLegs(stops: TraceStop[]): MovementLeg[] {
  const out: MovementLeg[] = [];
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1];
    const to = stops[i];
    out.push({
      from,
      to,
      gapS:
        from.at && to.at
          ? (to.at.getTime() - from.at.getTime()) / 1000
          : undefined,
      sameCamera:
        !!from.hit.cameraTag && from.hit.cameraTag === to.hit.cameraTag,
    });
  }
  return out;
}

/**
 * One line per confirmed sighting, in time order, with the movement from the
 * previous one. Sent to Argus so reports follow the subject's real timings.
 * `ref` is the segment key (`<video_id>@<start_s>`), unique across searches.
 */
export function timelineLines(
  stops: TraceStop[],
  zone: (tag: string) => string | undefined = cameraZone,
): string[] {
  const legs = movementLegs(stops);
  return stops.map((s, i) => {
    const cam = hitCameraLabel(s.hit);
    const where = s.hit.cameraTag ? zone(s.hit.cameraTag) : undefined;
    const when = s.at?.toISOString() ?? "unknown time";
    const leg = legs[i - 1];
    let move = "";
    if (leg) {
      const gap = leg.gapS === undefined ? "unknown time" : formatGap(leg.gapS);
      move = leg.sameCamera
        ? `; still on ${cam}, ${gap} after stop ${leg.from.order}`
        : `; moved from ${hitCameraLabel(leg.from.hit)} in ${gap}`;
    }
    return `${s.order}. ${when}${s.until ? ` to ${s.until.toISOString()} (live, ${s.detections} detections)` : ""} ${cam}${where ? ` in ${where}` : ""} (ref ${segmentKey(s.hit)}, score ${s.hit.score.toFixed(2)})${move}`;
  });
}
