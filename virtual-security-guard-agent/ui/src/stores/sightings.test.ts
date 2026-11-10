// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { VssHit } from "@/adapters/vss/types";
import { formatGap } from "@/lib/time";
import {
  confirmedSightings,
  movementLegs,
  routeFromSightings,
  timelineLines,
} from "./case";

const hit = (
  matchId: string,
  videoId: string,
  seekS: number,
  cameraTag = "cam-a",
): VssHit => ({
  matchId,
  rank: Number(matchId.slice(1)),
  videoId,
  cameraTag,
  startS: seekS,
  endS: seekS + 5,
  seekS,
  score: 0.8,
  ingestedAt: "2026-01-01T10:00:00Z",
});

describe("formatGap", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatGap(45)).toBe("45 s");
    expect(formatGap(185)).toBe("3 min 05 s");
    expect(formatGap(3720)).toBe("1 h 02 min");
    expect(formatGap(undefined)).toBe("unknown time");
  });
});

describe("confirmedSightings", () => {
  const grid = (id: string, hits: VssHit[]) => ({
    id,
    role: "agent",
    search: { hits },
  });
  const key = (h: VssHit) => `${h.videoId}@${h.seekS}`;

  it("unions sent confirms across grids, deduped by segment, in time order", () => {
    const turns = [
      grid("a1", [hit("m1", "v1", 120), hit("m2", "v2", 10)]),
      grid("a2", [hit("m1", "v1", 120), hit("m2", "v3", 60)]),
    ];
    const both = { m1: "confirm", m2: "confirm" } as const;
    const out = confirmedSightings(turns, {
      a1: { verdicts: both, sent: both },
      a2: { verdicts: both, sent: both },
    });
    expect(out.map(key)).toEqual(["v2@10", "v3@60", "v1@120"]);
  });

  it("lets a later grid's verdict on the same segment win", () => {
    const turns = [
      grid("a1", [hit("m1", "v1", 0)]),
      grid("a2", [hit("m3", "v1", 0)]),
    ];
    const out = confirmedSightings(turns, {
      a1: { verdicts: { m1: "confirm" }, sent: { m1: "confirm" } },
      a2: { verdicts: { m3: "reject" }, sent: { m3: "reject" } },
    });
    expect(out).toEqual([]);
  });

  it("ignores unsent verdicts and adds confirmed live sightings", () => {
    const turns = [grid("a1", [hit("m1", "v1", 0)])];
    const live = hit("m9", "v9", 30);
    const out = confirmedSightings(
      turns,
      { a1: { verdicts: { m1: "confirm" } } },
      [live],
    );
    expect(out).toEqual([live]);
  });
});

describe("movement", () => {
  const stops = routeFromSightings([
    hit("m1", "v2", 200, "cam-b"),
    hit("m2", "v1", 0, "cam-a"),
    hit("m3", "v3", 230, "cam-b"),
  ]);

  it("orders stops by time with gaps between them", () => {
    expect(stops.map((s) => s.hit.videoId)).toEqual(["v1", "v2", "v3"]);
    const legs = movementLegs(stops);
    expect(legs.map((l) => [l.gapS, l.sameCamera])).toEqual([
      [200, false],
      [30, true],
    ]);
  });

  it("writes timeline lines with refs and movement", () => {
    const lines = timelineLines(stops, () => undefined);
    expect(lines[0]).toMatch(/^1\. 2026-01-01T10:00:00\.000Z cam-a \(ref v1@0/);
    expect(lines[1]).toContain("moved from cam-a in 3 min 20 s");
    expect(lines[2]).toContain("still on cam-b, 30 s after stop 2");
  });

  it("adds the floorplan zone of each sighting's camera", () => {
    const lines = timelineLines(stops, (t) =>
      t === "cam-a" ? "Lobby" : undefined,
    );
    expect(lines[0]).toContain("cam-a in Lobby (ref");
    expect(lines[1]).toMatch(/cam-b \(ref/);
  });
});
