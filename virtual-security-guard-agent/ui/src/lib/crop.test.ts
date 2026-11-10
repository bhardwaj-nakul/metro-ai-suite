// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampUnitBox,
  containRect,
  meetsMinPx,
  pxToUnit,
  unitToPx,
  waitForFrame,
} from "@/lib/crop";

describe("clampUnitBox", () => {
  it("keeps a normal box inside the frame", () => {
    expect(clampUnitBox(0.1, 0.2, 0.3, 0.4)).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.4,
    });
  });

  it("flips a top-left drag into a positive box", () => {
    expect(clampUnitBox(0.5, 0.6, -0.2, -0.3)).toEqual({
      x: 0.3,
      y: 0.3,
      w: 0.2,
      h: 0.3,
    });
  });

  it("clamps to the frame edges", () => {
    const c = clampUnitBox(0.8, 0.8, 0.5, 0.5);
    expect(c.x).toBe(0.8);
    expect(c.y).toBe(0.8);
    expect(c.w).toBeCloseTo(0.2);
    expect(c.h).toBeCloseTo(0.2);
    const d = clampUnitBox(-0.4, -0.4, 0.6, 0.6);
    expect(d.x).toBe(0);
    expect(d.y).toBe(0);
    // x+w / y+h are inexact float sums of the literals, so compare width and
    // height approximately.
    expect(d.w).toBeCloseTo(0.2);
    expect(d.h).toBeCloseTo(0.2);
  });
});

describe("unit/pixel mapping", () => {
  it("round-trips through source pixels", () => {
    const box = clampUnitBox(0.25, 0.5, 0.4, 0.2);
    expect(pxToUnit(unitToPx(box, 1280, 720), 1280, 720)).toEqual(box);
  });
});

describe("meetsMinPx", () => {
  it("flags boxes that are too small for a useful face crop", () => {
    // 1280x720 frame, 48px minimum.
    expect(meetsMinPx(clampUnitBox(0, 0, 1, 1), 1280, 720)).toBe(true);
    expect(meetsMinPx(clampUnitBox(0, 0, 0.01, 0.1), 1280, 720)).toBe(false);
    expect(meetsMinPx(clampUnitBox(0, 0, 0.1, 0.01), 1280, 720)).toBe(false);
    expect(meetsMinPx(clampUnitBox(0, 0, 0.04, 0.07), 1280, 720)).toBe(true);
  });
});

describe("containRect", () => {
  it("pillarboxes a 16:9 frame in a taller box", () => {
    expect(containRect(800, 600, 1920, 1080)).toEqual({
      x: 0,
      y: 75,
      w: 800,
      h: 450,
    });
  });

  it("letterboxes a 16:9 frame in a wider box", () => {
    expect(containRect(1600, 450, 1920, 1080)).toEqual({
      x: 400,
      y: 0,
      w: 800,
      h: 450,
    });
  });

  it("falls back to the full box before the frame size is known", () => {
    expect(containRect(800, 600, 0, 0)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });
});

describe("waitForFrame", () => {
  afterEach(() => vi.useRealTimers());

  /** A <video> reporting the given seeking flag and readyState. */
  function video(seeking: boolean, readyState: number) {
    const v = document.createElement("video");
    Object.defineProperty(v, "seeking", {
      get: () => seeking,
      configurable: true,
    });
    Object.defineProperty(v, "readyState", {
      get: () => readyState,
      configurable: true,
    });
    return v;
  }

  it("resolves at once for a paused clip showing its frame", async () => {
    await expect(waitForFrame(video(false, 4))).resolves.toBeUndefined();
  });

  it("waits for a frame step to finish seeking", async () => {
    const v = video(true, 4);
    let done = false;
    const p = waitForFrame(v).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    Object.defineProperty(v, "seeking", { get: () => false });
    v.dispatchEvent(new Event("seeked"));
    await p;
    expect(done).toBe(true);
  });

  it("fails on a clip error or when no frame arrives in time", async () => {
    const broken = video(false, 0);
    const p = waitForFrame(broken);
    broken.dispatchEvent(new Event("error"));
    await expect(p).rejects.toThrow("The clip failed to load.");

    vi.useFakeTimers();
    const slow = waitForFrame(video(false, 1), 1000);
    vi.advanceTimersByTime(1000);
    await expect(slow).rejects.toThrow("The frame is not loaded yet.");
  });
});
