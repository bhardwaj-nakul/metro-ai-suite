// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { TraceStop } from "@/stores/case";
import { buildReportPdf } from "./pdf";
import type { ReportContent } from "./content";

const report = (over: Partial<ReportContent> = {}): ReportContent => ({
  preset: "brief",
  title: "Person near the escalator → lift",
  confidence: "medium",
  summary: "**Seen** twice.",
  subject: "",
  timeline: [],
  observations: [],
  actions: [],
  ...over,
});

const stop = (i: number): TraceStop => ({
  hit: {
    matchId: `m${i}`,
    rank: i,
    videoId: "v",
    cameraTag: "camera_1",
    startS: 0,
    endS: 2,
    seekS: 1,
    score: 0.5,
  },
  order: i,
  at: new Date(Date.UTC(2026, 9, 23, 10, i)),
});

/** Uncompressed PDF text, to look for what was drawn. */
const text = (r: ReportContent, stops: TraceStop[] = [], extra = {}) => {
  const doc = buildReportPdf({ report: r, stops, ...extra });
  return { doc, out: doc.output() };
};

describe("buildReportPdf", () => {
  it("says no sightings were confirmed on an empty route", () => {
    expect(text(report()).out).toContain("No sightings were confirmed.");
  });

  it("prints markdown as plain WinAnsi text", () => {
    const { out } = text(report({ summary: "**Lobby** → *Lift* 🚶" }));
    expect(out).toContain("(Lobby -> Lift ?) Tj");
  });

  it("puts a long subject on as many pages as it needs", () => {
    const subject = Array.from({ length: 200 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    const { doc } = text(report({ subject }));
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(3);
  });

  it("notes a map that can't be drawn instead of failing", () => {
    const { out } = text(report(), [stop(1)], {
      mapPng: "data:image/png;base64,bm90IGEgcG5n",
    });
    expect(out).toContain("The route map could not be drawn");
  });

  it("says when sightings have no thumbnail because of the cap", () => {
    const stops = [1, 2, 3].map((i) => stop(i));
    expect(text(report(), stops, { thumbLimit: 2 }).out).toContain(
      "first 2 sightings only",
    );
  });

  it("numbers sightings with the map's numbers", () => {
    const stops = [1, 2].map((i) => stop(i));
    const { out } = text(report(), stops, {
      numbers: new Map([
        [1, 1],
        [2, 1],
      ]),
    });
    expect(out).not.toContain("(2) Tj");
  });
});
