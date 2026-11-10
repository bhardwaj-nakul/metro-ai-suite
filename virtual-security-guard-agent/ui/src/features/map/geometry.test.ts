// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { clearLabelX } from "./geometry";

describe("clearLabelX", () => {
  const label = { x: 30, y: 25, w: 50, h: 12 };

  it("keeps a label that overlaps nothing", () => {
    expect(clearLabelX(label, [{ x: 30, y: 60, w: 50, h: 12 }], 4)).toBe(30);
  });

  it("slides past overlapping boxes, including ones it runs into", () => {
    const dot = { x: 34, y: 34, w: 12, h: 12 };
    const name = { x: 49, y: 20, w: 45, h: 11 };
    const far = { x: 100, y: 28, w: 10, h: 10 };
    expect(clearLabelX(label, [far, name, dot], 4)).toBe(114);
  });
});
