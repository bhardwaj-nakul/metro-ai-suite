// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { classifyPrompt } from "@/stores/investigation.logic";
import type { HermesMessage } from "@/adapters/hermes/types";
import { groundingForRun, parseSearchResult } from "./grounding";

const liveHit = {
  video_id: "785a615cca7a473bb5cc5335bf051005",
  source: "live",
  stream_id: "785a615cca7a473bb5cc5335bf051005",
  observed_at: "2026-05-01T10:00:04Z",
  seek_s: 4,
  score: 0.82,
  url: "http://gw/datastore/live-streams/785a/segments/1777000000.mp4",
  frame: {
    video_id: "785a615cca7a473bb5cc5335bf051005",
    timestamp: 4.2,
    media_path: "segments/1777000000.mp4",
    bucket_name: "live-streams",
    crop_bbox: "10,20,110,220",
  },
};

describe("live grounding", () => {
  it("maps live hits to stream camera, observed time and frame poster", () => {
    const g = parseSearchResult(
      JSON.stringify({ query_id: "q1", results: [liveHit] }) +
        "\nresource link: vss://frame",
    );
    const h = g!.hits[0];
    expect(h.source).toBe("live");
    expect(h.cameraTag).toBe(liveHit.stream_id);
    expect(h.observedAt).toBe(liveHit.observed_at);
    expect(h.posterUrl).toContain("/manager/frames?");
    expect(h.posterUrl).toContain("crop_bbox=10%2C20%2C110%2C220");
    expect(h.playbackUrl).toBe(
      "/vss/datastore/live-streams/785a/segments/1777000000.mp4",
    );
  });

  it("drops path-traversal frame locators", () => {
    const g = parseSearchResult(
      JSON.stringify({
        results: [
          { ...liveHit, frame: { ...liveHit.frame, media_path: "../x" } },
        ],
      }),
    );
    expect(g!.hits[0].frame?.mediaPath).toBeUndefined();
  });
});

describe("result rows", () => {
  const row = (video_id: string, extra = {}) => ({
    video_id,
    score: 0.5,
    ...extra,
  });

  it("numbers refs by raw row, so a bad row never shifts later refs", () => {
    const g = parseSearchResult(
      JSON.stringify({
        results: [{ video_id: "bad id!" }, row("v2"), row("v3")],
      }),
    )!;
    expect(g.hits.map((h) => [h.matchId, h.videoId])).toEqual([
      ["m2", "v2"],
      ["m3", "v3"],
    ]);
    expect(g.unreadable).toBe(1);
  });

  it("drops unscored rows and duplicate refs as unreadable", () => {
    const g = parseSearchResult(
      JSON.stringify({
        results: [
          row("v1"),
          row("v2", { match_id: "m1" }),
          { video_id: "v3", score: null },
          row("v4", { score: "0.25" }),
        ],
      }),
    )!;
    expect(g.hits.map((h) => [h.matchId, h.score])).toEqual([
      ["m1", 0.5],
      ["m4", 0.25],
    ]);
    expect(g.unreadable).toBe(2);
  });

  it("keeps a result whose rows are all unreadable, so the UI can say so", () => {
    const g = parseSearchResult(
      JSON.stringify({ results: [{ video_id: "" }] }),
    );
    expect(g).toEqual({ queryId: undefined, hits: [], unreadable: 1 });
  });
});

describe("groundingForRun", () => {
  const msg = (
    role: HermesMessage["role"],
    content: string,
    toolName?: string,
  ): HermesMessage => ({ id: content, role, content, toolName });
  const result = (qid: string, video: string) =>
    JSON.stringify({ query_id: qid, results: [{ video_id: video, score: 1 }] });
  const messages = [
    msg("user", "find A"),
    msg("tool", result("qa", "va"), "vss_search_video"),
    msg("assistant", "grid A"),
    msg("user", "write a report"),
    msg("assistant", "report"),
  ];

  it("reads the search result of the run with that prompt", () => {
    expect(groundingForRun(messages, "find A")?.queryId).toBe("qa");
  });

  it("does not borrow another run's result", () => {
    expect(groundingForRun(messages, "write a report")).toBeUndefined();
  });

  it("uses the most recent run when the prompt is not found", () => {
    const later = [
      ...messages,
      msg("user", "x"),
      msg("tool", result("qb", "vb"), "vss_search_video"),
    ];
    expect(groundingForRun(later, "missing")?.queryId).toBe("qb");
  });
});

describe("classifyPrompt", () => {
  it.each([
    ["Add camera rtsp://10.0.0.5:8554/lobby as Lobby", "streams"],
    ["remove the back alley camera", "streams"],
    ["list live streams", "streams"],
    ["Find a person in a blue jacket", "search"],
    ["Write a handover report", "report"],
  ])("%s → %s", (text, kind) => {
    expect(classifyPrompt(text, false)).toBe(kind);
  });
});
