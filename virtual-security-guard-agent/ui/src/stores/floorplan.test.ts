// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cameraZone,
  freeFloorplanCameras,
  useFloorplanStore,
} from "./floorplan";

const ENTRY = "P_Lev_4_Main_Entry_ip_54";
const STAIRS = "P_Lev_4_stairs_ip_95";
const plan = {
  cameras: {
    [ENTRY]: { x: 0, y: 0, zone: "Main Entry" },
    [STAIRS]: { x: 10, y: 0, zone: "Cube Stairs" },
  },
};

describe("floorplan placement", () => {
  beforeEach(() => useFloorplanStore.getState().setPlan(plan));

  it("lists plan cameras with no live stream, with their zone", () => {
    expect(freeFloorplanCameras([{ tag: STAIRS }])).toEqual([
      `${ENTRY} (Main Entry)`,
    ]);
  });

  it("locates a tag at its plan camera's zone", () => {
    expect(cameraZone(STAIRS)).toBe("Cube Stairs");
    expect(cameraZone("not_on_plan")).toBeUndefined();
  });
});

describe("default floorplan from /floorplan.json", () => {
  const serve = (body: string, status = 200) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status })),
    );

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the served plan until one is uploaded, and again on reset", async () => {
    serve(JSON.stringify(plan));
    const fp = await import("./floorplan");
    await fp.loadDefaultFloorplan();
    const store = fp.useFloorplanStore;
    expect(store.getState().defaultStatus).toBe("ready");
    expect(Object.keys(store.getState().plan.cameras)).toEqual([ENTRY, STAIRS]);

    const upload = { cameras: { camera_1: { x: 1, y: 1 } } };
    store.getState().setPlan(upload, "site.json");
    expect(store.getState().plan).toBe(upload);
    store.getState().reset();
    expect(store.getState()).toMatchObject({
      source: "default",
      fileName: undefined,
    });
    expect(Object.keys(store.getState().plan.cameras)).toEqual([ENTRY, STAIRS]);
  });

  it("reports a missing or invalid plan", async () => {
    serve("{}");
    const fp = await import("./floorplan");
    await fp.loadDefaultFloorplan();
    expect(fp.useFloorplanStore.getState().defaultStatus).toBe("error");
    expect(fp.useFloorplanStore.getState().defaultError).toMatch(/cameras/);
  });

  it("tries again after a failed load, and tells Argus the plan is unavailable", async () => {
    serve("", 503);
    const fp = await import("./floorplan");
    await fp.loadDefaultFloorplan();
    expect(fp.freeFloorplanCameras([])).toEqual({
      unavailable: expect.stringMatching(/HTTP 503/),
    });
    serve(JSON.stringify(plan));
    await fp.loadDefaultFloorplan();
    expect(fp.useFloorplanStore.getState().defaultStatus).toBe("ready");
  });

  it("drops a saved upload that no longer validates, and says so", async () => {
    localStorage.setItem(
      "vsg.floorplan.v1",
      JSON.stringify({
        state: {
          source: "upload",
          fileName: "old.json",
          plan: { cameras: { c: { x: "", y: 0 } } },
        },
        version: 0,
      }),
    );
    const fp = await import("./floorplan");
    expect(fp.useFloorplanStore.getState()).toMatchObject({
      source: "default",
      discardedUpload: "old.json",
    });
  });
});

describe("saving an uploaded floorplan", () => {
  afterEach(() => vi.restoreAllMocks());

  it("says when the browser couldn't keep it", () => {
    const store = useFloorplanStore.getState();
    expect(store.setPlan(plan, "ok.json")).toBe(true);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const big = { cameras: { camera_1: { x: 1, y: 1 } } };
    expect(useFloorplanStore.getState().setPlan(big, "big.json")).toBe(false);
    // Still shown in this tab.
    expect(useFloorplanStore.getState().plan).toBe(big);
  });
});

describe("floorplan schema", () => {
  it("rejects non-numbers and zones without exactly one shape", async () => {
    const { parseFloorplan } = await import("@/features/map/schema");
    expect(parseFloorplan({ cameras: { c: { x: null, y: 0 } } }).ok).toBe(
      false,
    );
    expect(
      parseFloorplan({
        cameras: { c: { x: 0, y: 0 } },
        zones: [{ name: "Lobby" }],
      }).ok,
    ).toBe(false);
  });
});
