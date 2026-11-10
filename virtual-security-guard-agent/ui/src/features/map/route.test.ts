// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { normalizeStoredQuery } from "@/adapters/vss/normalize";
import { layoutRoute, stopNumbers } from "./route";
import type { Floorplan } from "./schema";

const TAG = "P_Lev_4_External_Lift_foyer_ip_70";

/** One live result as GET /manager/search/:queryId returns it. */
const liveResult = (rank: number, videoId: string, tags?: string) => ({
  metadata: {
    rank,
    video_id: videoId,
    segment_start: 3.5,
    segment_end: 9.5,
    ...(tags && { tags }),
    video_metadata: tags ? { tags: [tags] } : {},
    best_frame_info: {
      is_live: true,
      video_id: videoId,
      timestamp: 5.5,
      media_path: "segments/1791969330.mp4",
      bucket_name: "live-streams",
    },
  },
});

const plan: Floorplan = {
  cameras: { [TAG]: { x: 10, y: 20 } },
};

describe("live hits are keyed by their VSS tag", () => {
  it("takes the camera tag from the search result, not the stream id", () => {
    const q = normalizeStoredQuery({
      queryId: "q1",
      results: [liveResult(1, "d85c146112d248a288a3674fe3e9ad11", TAG)],
    });
    expect(q.hits[0].cameraTag).toBe(TAG);
    expect(q.hits[0].streamId).toBe("d85c146112d248a288a3674fe3e9ad11");
  });

  it("falls back to the stream id when the hit has no tag", () => {
    const q = normalizeStoredQuery({
      queryId: "q1",
      results: [liveResult(1, "stream-x")],
    });
    expect(q.hits[0].cameraTag).toBe("stream-x");
  });

  it("places tagged live hits from different streams on one floorplan node", () => {
    const q = normalizeStoredQuery({
      queryId: "q1",
      results: [liveResult(1, "stream-a", TAG), liveResult(2, "stream-b", TAG)],
    });
    const stops = q.hits.map((hit, i) => ({ hit, order: i + 1 }));
    const route = layoutRoute(stops, plan);
    expect(route.offMap).toEqual([]);
    expect(route.visits).toHaveLength(1);
    expect(route.visits[0].orders).toEqual([1, 2]);
  });
});

describe("stopNumbers", () => {
  const hit = (cameraTag: string, i: number) => ({
    matchId: `m${i}`,
    rank: i,
    videoId: "v",
    cameraTag,
    startS: 0,
    endS: 1,
    seekS: 0,
    score: 1,
  });
  const twoCams: Floorplan = {
    cameras: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
  };

  it("numbers stops the way the map draws them", () => {
    const stops = ["a", "a", "elsewhere", "b", "a"].map((t, i) => ({
      hit: hit(t, i + 1),
      order: i + 1,
    }));
    const n = stopNumbers(stops, twoCams);
    // a,a merge into visit 1; the off-plan stop has no number.
    expect([1, 2, 3, 4, 5].map((o) => n.get(o))).toEqual([
      1,
      1,
      undefined,
      2,
      3,
    ]);
    expect(layoutRoute(stops, twoCams).visits.map((v) => v.index)).toEqual([
      1, 2, 3,
    ]);
  });

  it("does not merge visits to one camera split by an off-plan stop", () => {
    const stops = ["a", "elsewhere", "a"].map((t, i) => ({
      hit: hit(t, i + 1),
      order: i + 1,
    }));
    const { visits, offMap } = layoutRoute(stops, twoCams);
    expect(visits.map((v) => v.orders)).toEqual([[1], [3]]);
    expect(offMap).toHaveLength(1);
  });
});
