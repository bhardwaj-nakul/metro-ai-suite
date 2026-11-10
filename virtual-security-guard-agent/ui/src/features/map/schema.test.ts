// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { planSize } from "./geometry";
import { parseFloorplan } from "./schema";

/**
 * The plans the deployment ships (deploy/floorplans/*.json). They sit outside
 * the ui/ Docker build context, so the image build finds none and skips.
 */
const deployed = import.meta.glob<string>(
  "../../../../deploy/floorplans/*.json",
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
);

const error = (plan: unknown) => {
  const r = parseFloorplan(plan);
  return r.ok ? undefined : r.error;
};

describe("floorplan schema", () => {
  const files = Object.entries(deployed);
  it.skipIf(files.length === 0)("accepts every shipped floorplan", () => {
    for (const [file, text] of files)
      expect(parseFloorplan(text), file).toMatchObject({ ok: true });
  });

  it("rejects camera keys VSS can't use as a camera name", () => {
    expect(error({ cameras: { "lobby cam": { x: 1, y: 1 } } })).toMatch(
      /camera keys must be 1-128 letters, digits, _ or -/,
    );
    expect(error({ cameras: { ["a".repeat(129)]: { x: 1, y: 1 } } })).toMatch(
      /camera keys/,
    );
    expect(error({ cameras: { "Cam_1-b": { x: 1, y: 1 } } })).toBeUndefined();
  });

  it("rejects positions the map can't show", () => {
    expect(error({ cameras: { c: { x: -5, y: 1 } } })).toMatch(/cameras\.c\.x/);
    expect(
      error({
        canvas: { width: 100, height: 100 },
        cameras: { c: { x: 150, y: 10 } },
      }),
    ).toMatch(/cameras\.c: is outside the 100x100 canvas/);
    expect(
      error({
        cameras: { c: { x: 1, y: 1 } },
        zones: [
          {
            name: "Z",
            points: [
              [-1, 0],
              [1, 0],
              [1, 1],
            ],
          },
        ],
      }),
    ).toBeDefined();
  });

  it("rejects duplicate zone names", () => {
    const rect = { x: 0, y: 0, w: 10, h: 10 };
    expect(
      error({
        cameras: { c: { x: 1, y: 1 } },
        zones: [
          { name: "Lobby", rect },
          { name: "Lobby", rect },
        ],
      }),
    ).toMatch(/zone names must be unique/);
  });

  it("sizes a plan with a very large zone without overflowing the stack", () => {
    const points = Array.from(
      { length: 300_000 },
      (_, i) => [i % 900, i % 700] as [number, number],
    );
    expect(
      planSize({
        cameras: { c: { x: 1, y: 1 } },
        zones: [{ name: "Z", points }],
      }),
    ).toEqual({ width: 979, height: 779 });
  });
});
