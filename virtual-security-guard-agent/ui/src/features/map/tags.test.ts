// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { cameraState, offPlanTags, placedTags, planCamera } from "./tags";
import type { Floorplan } from "./schema";

const ENTRY = "P_Lev_4_Main_Entry_ip_54";
const LOBBY = "P_Lev_4_Lobby_ip_9";
const plan: Floorplan = {
  cameras: {
    [ENTRY]: { x: 0, y: 0, zone: "Main Entry" },
    [LOBBY]: { x: 10, y: 0, zone: "Lobby" },
  },
};

describe("plan camera keys are VSS tags", () => {
  it("finds a camera by its tag, never by an inherited property", () => {
    expect(planCamera(plan, LOBBY)?.zone).toBe("Lobby");
    expect(planCamera(plan, "constructor")).toBeUndefined();
  });

  it("lists VSS tags that are not on the plan", () => {
    expect(offPlanTags(plan, [ENTRY, "off_plan_cam", "toString"])).toEqual([
      "off_plan_cam",
      "toString",
    ]);
  });

  it("lists the plan tags that have a live stream", () => {
    expect([
      ...placedTags(plan, [{ tag: LOBBY }, { tag: "not_on_plan" }]),
    ]).toEqual([LOBBY]);
  });
});

describe("cameraState", () => {
  const vss = new Set([ENTRY, LOBBY]);
  it("is live, mapped or empty", () => {
    expect(cameraState(ENTRY, vss, new Set([ENTRY]))).toBe("live");
    expect(cameraState(LOBBY, vss, new Set())).toBe("mapped");
    expect(cameraState("spare", vss, new Set())).toBe("empty");
  });

  it("treats every tag as mapped until VSS's tag list is known", () => {
    expect(cameraState("spare", undefined, new Set())).toBe("mapped");
  });
});
