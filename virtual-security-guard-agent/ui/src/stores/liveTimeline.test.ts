// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VssHit } from "@/adapters/vss/types";
import { routeOf } from "./investigation.logic";
import {
  addHits,
  capSightings,
  restoreBySession,
  untimedLiveHits,
  useLiveTimelineStore,
  type LiveSighting,
} from "./liveTimeline";

/** A live hit on `camera` at 10:00 plus `s` seconds. */
const hit = (camera: string, s: number, score = 0.8): VssHit => ({
  matchId: `m${s}`,
  rank: 1,
  videoId: camera,
  streamId: camera,
  cameraTag: camera,
  source: "live",
  observedAt: new Date(Date.UTC(2026, 0, 1, 10, 0, s)).toISOString(),
  startS: 0,
  endS: 0,
  seekS: 0,
  score,
});
const at = (s: number) =>
  new Date(Date.UTC(2026, 0, 1, 10, 0, s)).toISOString();
const view = (xs: readonly LiveSighting[]) =>
  xs.map((x) => [x.camera, x.start, x.end, x.count]);

describe("addHits", () => {
  it("folds detections on one camera into a sighting within the gap", () => {
    let t = addHits([], "w1", [hit("cam_a", 10), hit("cam_a", 0)]);
    t = addHits(t, "w1", [hit("cam_a", 0), hit("cam_a", 10), hit("cam_a", 50)]);
    expect(view(t)).toEqual([["cam_a", at(0), at(50), 3]]);
  });

  it("starts a new sighting on another camera or after a gap over 60 s", () => {
    const t = addHits([], "w1", [
      hit("cam_a", 0),
      hit("cam_b", 5),
      hit("cam_a", 30),
      hit("cam_a", 95),
    ]);
    expect(view(t)).toEqual([
      ["cam_a", at(0), at(30), 2],
      ["cam_b", at(5), at(5), 1],
      ["cam_a", at(95), at(95), 1],
    ]);
  });

  it("keeps the best frame, ignores non-live hits, and never spans watches", () => {
    let t = addHits([], "w1", [hit("cam_a", 0, 0.5), hit("cam_a", 10, 0.9)]);
    expect(t[0].best.score).toBe(0.9);
    t = addHits(t, "w2", [
      hit("cam_a", 20),
      { ...hit("cam_b", 30), source: "video" },
    ]);
    expect(t.map((x) => [x.watch, x.count])).toEqual([
      ["w1", 2],
      ["w2", 1],
    ]);
  });

  it("gives each watch its own sighting ids for the same footage", () => {
    const t = addHits([], "w1", [hit("cam_a", 0)]);
    const again = addHits(t, "w2", [hit("cam_a", 0)]);
    expect(again.map((x) => x.id)).toEqual([
      "w1:cam_a@" + at(0),
      "w2:cam_a@" + at(0),
    ]);
  });

  it("counts live hits it can't place in time", () => {
    const untimed = { ...hit("cam_a", 0), observedAt: undefined };
    expect(untimedLiveHits([untimed, hit("cam_a", 5)])).toBe(1);
  });

  it("returns the same array when a poll adds nothing", () => {
    const t = addHits([], "w1", [hit("cam_a", 0)]);
    expect(addHits(t, "w1", [hit("cam_a", 0)])).toBe(t);
  });
});

describe("capSightings", () => {
  it("drops the oldest unconfirmed sightings, never a confirmed one", () => {
    const t = addHits([], "w1", [
      hit("cam_a", 0),
      hit("cam_b", 1),
      hit("cam_c", 2),
      hit("cam_d", 3),
    ]).map((x, i) => ({ ...x, confirmed: i === 0 }));
    expect(capSightings(t, 2).map((x) => x.camera)).toEqual(["cam_a", "cam_d"]);
    expect(capSightings(t, 4)).toBe(t);
  });
});

describe("restoreBySession", () => {
  it("keeps well-formed timelines and drops anything else", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const [good] = addHits([], "w1", [hit("cam_a", 0)]);
    expect(restoreBySession(null)).toEqual({});
    expect(restoreBySession({ bySession: null })).toEqual({});
    expect(restoreBySession({ bySession: [] })).toEqual({});
    expect(
      restoreBySession({
        bySession: { s1: [good, { id: "x" }, null], s2: "junk" },
      }),
    ).toEqual({ s1: [good] });
  });
});

describe("live timeline store", () => {
  afterEach(() => {
    useLiveTimelineStore.setState({ bySession: {} });
    vi.restoreAllMocks();
  });

  it("keeps working when browser storage is full", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const add = useLiveTimelineStore.getState().addHits;
    expect(add("s1", "w1", [hit("cam_a", 0)])).toBe(true);
    const [s] = useLiveTimelineStore.getState().bySession.s1;
    expect(() =>
      useLiveTimelineStore.getState().toggleConfirmed("s1", s.id),
    ).not.toThrow();
    expect(useLiveTimelineStore.getState().bySession.s1[0].confirmed).toBe(
      true,
    );
  });

  it("Confirm on a new watch's sighting leaves the old watch's one alone", () => {
    const store = useLiveTimelineStore.getState();
    store.addHits("s1", "w1", [hit("cam_a", 0)]);
    store.addHits("s1", "w2", [hit("cam_a", 0)]);
    const [, mine] = useLiveTimelineStore.getState().bySession.s1;
    store.toggleConfirmed("s1", mine.id);
    expect(
      useLiveTimelineStore.getState().bySession.s1.map((x) => x.confirmed),
    ).toEqual([false, true]);
  });
});

describe("live sightings on the route", () => {
  it("the same footage confirmed from two watches is one stop", () => {
    const t = addHits(addHits([], "w1", [hit("cam_a", 0)]), "w2", [
      hit("cam_a", 0),
    ]).map((x) => ({ ...x, confirmed: true }));
    expect(routeOf({ turns: [], reviews: {} }, t)).toHaveLength(1);
  });

  it("adds each confirmed sighting as one stop spanning start to end", () => {
    const t = addHits([], "w1", [
      hit("cam_a", 0),
      hit("cam_a", 40),
      hit("cam_b", 90),
    ]);
    const live = t.map((x, i) => ({ ...x, confirmed: i === 0 }));
    const stops = routeOf({ turns: [], reviews: {} }, live);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ detections: 2 });
    expect(stops[0].at?.toISOString()).toBe(at(0));
    expect(stops[0].until?.toISOString()).toBe(at(40));
  });
});
