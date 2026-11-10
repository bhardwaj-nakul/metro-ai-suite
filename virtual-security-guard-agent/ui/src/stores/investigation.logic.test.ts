// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { HermesMessage } from "@/adapters/hermes/types";
import type { VssHit } from "@/adapters/vss/types";
import { placementInput } from "@/features/map/tags";
import { hitKey } from "@/lib/hits";
import { serializeFeedback } from "@/protocol/feedback";
import {
  applyRunEvent,
  classifyPrompt,
  instructionContext,
  newAgentTurn,
  phaseFromTurns,
  subjectImageOf,
  turnsFromMessages,
  subjectTextOf,
  reviewsFromTurns,
  type AgentTurn,
  type OperatorTurn,
  type Turn,
} from "./investigation.logic";

const hit = (matchId: string, extra: Partial<VssHit> = {}): VssHit => ({
  matchId,
  rank: Number(matchId.slice(1)),
  videoId: `v-${matchId}`,
  cameraTag: "camera_1",
  startS: 0,
  endS: 5,
  seekS: 0,
  score: 0.9,
  ingestedAt: "2026-01-01T10:00:00Z",
  ...extra,
});

const grid = (id: string, hits: VssHit[]): AgentTurn => ({
  id,
  role: "agent",
  text: '```vsg-matches\n{"v":1,"keep":[]}\n```',
  reasoning: "",
  tools: [],
  status: "done",
  createdAt: 0,
  search: { queryId: `q-${id}`, hits, unreadable: 0 },
});

const review = (confirm: string[], reject: string[]): OperatorTurn => ({
  id: `op-${confirm.join()}`,
  role: "operator",
  kind: "feedback",
  text: "",
  input: serializeFeedback({ confirm, reject }),
  createdAt: 0,
});

describe("phaseFromTurns", () => {
  const reply = (text = "Done."): AgentTurn => ({
    ...grid("r", []),
    text,
    search: undefined,
  });

  it("is traced after a confirming review, as at the end of a live run", () => {
    const turns: Turn[] = [
      grid("g1", [hit("m1")]),
      review(["m1"], []),
      reply(),
    ];
    expect(phaseFromTurns(turns)).toBe("traced");
    // A report afterwards keeps the traced state.
    expect(phaseFromTurns([...turns, reply("Report.")])).toBe("traced");
  });

  it("is validating while the latest grid has no confirmed review", () => {
    expect(phaseFromTurns([grid("g1", [hit("m1")])])).toBe("validating");
    expect(
      phaseFromTurns([grid("g1", [hit("m1")]), review([], ["m1"]), reply()]),
    ).toBe("validating");
  });
});

describe("reviewsFromTurns", () => {
  it("keys each sent review by the grid it reviewed", () => {
    const turns: Turn[] = [
      grid("g1", [hit("m1"), hit("m2")]),
      review(["m1"], ["m2"]),
      grid("g2", [hit("m1")]),
      review([], ["m1"]),
    ];
    const verdicts = { m1: "confirm", m2: "reject" };
    expect(reviewsFromTurns(turns)).toEqual({
      g1: { verdicts, sent: verdicts },
      g2: { verdicts: { m1: "reject" }, sent: { m1: "reject" } },
    });
  });
});

describe("instructionContext", () => {
  const env = {
    fleet: { cameras: [], hasLiveCamera: true },
    freePositions: [],
    zone: () => "Lobby",
    minScore: 0.5,
    limit: 12,
  };
  const turns: Turn[] = [grid("g1", [hit("m1"), hit("m2")])];
  const reviews = { g1: { verdicts: {}, sent: { m1: "confirm" as const } } };

  it("tells Argus the latest grid's verdicts, query and route", () => {
    const ctx = instructionContext(
      { phase: "traced", turns, reviews, live: [], subject: " red " },
      env,
    );
    expect(ctx).toMatchObject({
      confirmed: ["m1"],
      rejected: [],
      activeQueryId: "q-g1",
      subject: "red",
      hasLiveCamera: true,
    });
    expect(ctx.sightings).toEqual([
      expect.stringContaining("camera_1 in Lobby"),
    ]);
  });

  it("never reports stale live cameras after a failed refresh", () => {
    const ctx = instructionContext(
      { phase: "idle", turns: [], reviews: {}, live: [] },
      { ...env, fleet: { ...env.fleet, error: "502" } },
    );
    expect(ctx.cameras).toEqual({
      unavailable: "camera status unavailable: 502",
    });
    expect(ctx.hasLiveCamera).toBe(false);
  });
});

describe("hitKey", () => {
  it("keeps live sightings apart that share a rounded segment start", () => {
    const live = (observedAt: string) =>
      hit("m1", {
        source: "live",
        streamId: "s1",
        videoId: "s1",
        observedAt,
      });
    expect(hitKey(live("2026-01-01T10:00:00Z"))).not.toBe(
      hitKey(live("2026-01-01T10:00:00.4Z")),
    );
    expect(hitKey(hit("m1"))).toBe(hitKey(hit("m9", { videoId: "v-m1" })));
  });
});

describe("placementInput", () => {
  it("names and tags a stream after its plan camera, zone as description", () => {
    const plan = { cameras: { camera_2: { x: 0, y: 0, zone: "Lobby" } } };
    expect(placementInput(plan, "camera_2", { streamUrl: "rtsp://x" })).toEqual(
      {
        streamUrl: "rtsp://x",
        name: "camera_2",
        tags: ["camera_2"],
        description: "Lobby",
      },
    );
  });
});

describe("investigation subject", () => {
  const op = (
    text: string,
    kind: OperatorTurn["kind"] = "search",
    image?: string,
  ): OperatorTurn => ({
    id: text,
    role: "operator",
    kind,
    text,
    input: text,
    createdAt: 0,
    ...(image && { image: { imageUrl: image, previewUrl: image } }),
  });

  it("is the latest searched image, else the latest search prompt", () => {
    const turns: Turn[] = [
      op("Can you access the VSS MCP"),
      op("Find this person", "search", "/a.jpg"),
      op("Search for the person in this image.", "search", "/crop.jpg"),
      op("Write a handover report", "report"),
      op("also check camera_2"),
    ];
    expect(subjectImageOf(turns)?.imageUrl).toBe("/crop.jpg");
    expect(subjectTextOf(turns)).toBe("also check camera_2");
    expect(subjectImageOf(turns.slice(0, 1))).toBeUndefined();
    expect(subjectTextOf(turns.slice(0, 1))).toBe("Can you access the VSS MCP");
  });

  it("skips a prompt whose finished reply ran no search", () => {
    const reply = (extra: Partial<AgentTurn> = {}): AgentTurn => ({
      ...grid("r", []),
      search: undefined,
      ...extra,
    });
    const searched = reply({ search: { hits: [], unreadable: 0 } });
    const turns: Turn[] = [
      op("Find this person", "search", "/a.jpg"),
      searched,
      op("Which cameras are live right now?"),
      reply(),
    ];
    expect(subjectTextOf(turns)).toBe("Find this person");
    expect(subjectImageOf(turns)?.imageUrl).toBe("/a.jpg");
    const running = [
      ...turns,
      op("also check camera_2"),
      reply({ status: "streaming" }),
    ];
    expect(subjectTextOf(running)).toBe("also check camera_2");
  });
});

describe("classifyPrompt", () => {
  it.each([
    "Find a man in a red jacket near the escalator",
    "Search the escalators on level 2 for a person with a backpack",
    "show me the person in a red jacket on camera 3",
    "Show footage from camera_2 between 14:00 and 15:00",
    "list everyone seen on camera 1",
    "Show me which cameras saw a person in a blue jacket",
    "Find the person reported near the gate",
  ])("treats %j as a search", (text) => {
    expect(classifyPrompt(text, false)).toBe("search");
  });

  it.each([
    "Write a handover report",
    "Escalate this incident",
    "Draft an escalation report for the lobby",
    "Write up what happened",
    [
      "Write a escalation report from the 2 confirmed sightings.",
      "Report preset: Escalation report. The sightings, in time order, with the subject's movement between cameras:",
      "1. camera_1 (Lobby) at 2026-01-01T10:00:00.000Z\n2. camera_2 (Hall) at 2026-01-01T10:02:00.000Z; moved from camera_1 in 2 min",
    ].join("\n\n"),
  ])("treats %j as a report", (text) => {
    expect(classifyPrompt(text, false)).toBe("report");
  });

  it.each([
    "Add a camera at rtsp://10.0.0.5/stream1",
    "Pause camera_2",
    "remove the lobby camera",
    "Resume the paused streams",
    "list cameras",
    "show all live cameras",
    "show me the cameras",
  ])("treats %j as camera management", (text) => {
    expect(classifyPrompt(text, false)).toBe("streams");
  });

  it("always treats a photo as a search", () => {
    expect(classifyPrompt("Write a handover report", true)).toBe("search");
  });
});

describe("applyRunEvent completed", () => {
  const streamed = { ...newAgentTurn(), text: "Found 3.\n```vsg-mat" };

  it("prefers the run output when the stream lost part of the reply", () => {
    const full = 'Found 3.\n```vsg-matches\n{"v":1,"keep":["m1"]}\n```';
    const t = applyRunEvent(streamed, { type: "completed", output: full });
    expect(t.status).toBe("done");
    expect(t.text).toBe(full);
  });

  it("keeps the streamed text when the output is shorter or missing", () => {
    expect(
      applyRunEvent(streamed, { type: "completed", output: "Found" }).text,
    ).toBe(streamed.text);
    expect(applyRunEvent(streamed, { type: "completed" }).text).toBe(
      streamed.text,
    );
  });
});

describe("tool call credentials", () => {
  it("redacts RTSP credentials in tool arguments and previews", () => {
    const started = applyRunEvent(newAgentTurn(), {
      type: "tool.started",
      tool: "vss_add_stream",
      preview: '{"stream_url":"rtsp://admin:secret@10.0.0.5/live"}',
    });
    const done = applyRunEvent(started, {
      type: "tool.completed",
      tool: "vss_add_stream",
      preview: "added rtsp://admin:secret@10.0.0.5/live",
    });
    const t = done.tools[0];
    expect(t.args).toBe('{"stream_url":"rtsp://***@10.0.0.5/live"}');
    expect(t.preview).toBe("added rtsp://***@10.0.0.5/live");
  });

  it("redacts a replayed tool result before truncating it", () => {
    const content = `${" ".repeat(485)}rtsp://admin:secret@10.0.0.5/live`;
    const turns = turnsFromMessages([
      { id: "1", role: "user", content: "add camera" },
      {
        id: "2",
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "vss_add_stream", arguments: "{}" }],
      },
      { id: "3", role: "tool", content, toolCallId: "c1" },
    ] as HermesMessage[]);
    const preview = (turns[1] as AgentTurn).tools[0].preview ?? "";
    expect(preview).not.toContain("secr");
    expect(preview).toContain("rtsp://***@");
  });
});
