// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/**
 * Opt-in end-to-end smoke test against a deployed VSG proxy (nginx or the Vite
 * dev server). Skipped unless VSG_LIVE_BASE is set, e.g.
 *
 *   VSG_LIVE_BASE=http://127.0.0.1:12346 npx vitest run src/test/live.smoke.test.ts
 *
 * It runs one real Argus search (a few minutes on a local 8B model) and deletes
 * the Hermes session afterwards.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createHttpHermes } from "@/adapters/hermes/http";
import type { RunEvent } from "@/adapters/hermes/types";
import { createHttpVss } from "@/adapters/vss/http";
import { resolveRefs } from "@/lib/hits";
import { buildSearchInput } from "@/protocol/feedback";
import { groundingForRun } from "@/protocol/grounding";
import { buildInstructions } from "@/protocol/instructions";
import { parseAgentText } from "@/protocol/parser";

// Read via globalThis so the app tsconfig needn't include node types.
const ENV =
  (globalThis as { process?: { env: Record<string, string | undefined> } })
    .process?.env ?? {};
const BASE = ENV.VSG_LIVE_BASE?.replace(/\/$/, "");
const PROMPT = ENV.VSG_LIVE_PROMPT ?? "Find a person wearing a dark jacket.";

describe.skipIf(!BASE)("live smoke", () => {
  const hermes = createHttpHermes(`${BASE}/hermes`);
  const vss = createHttpVss(`${BASE}/vss`);
  let sessionId: string | undefined;
  let tags: string[] = [];

  afterAll(async () => {
    if (sessionId) await hermes.deleteSession(sessionId).catch(() => {});
  });

  it("reaches Hermes and VSS through the proxy", async () => {
    expect(await hermes.health()).toBe(true);
    expect(await vss.health()).toBe(true);
    tags = await vss.listTags();
    expect(tags.length).toBeGreaterThan(0);
  });

  it("streams an Argus search that ends in a renderable directive", async () => {
    const session = await hermes.createSession(`VSG · smoke · ${PROMPT}`);
    sessionId = session.id;
    const { runId } = await hermes.startRun({
      sessionId,
      input: buildSearchInput({ text: PROMPT, limit: 12 }),
      instructions: buildInstructions({
        phase: "idle",
        cameras: tags,
        freePositions: [],
        hasLiveCamera: true,
        minScore: 0.6,
        limit: 12,
      }),
    });

    const events: RunEvent[] = [];
    let text = "";
    await hermes.streamRun(runId, (e) => {
      events.push(e);
      if (e.type === "delta") text += e.text;
      if (e.type === "completed" && e.output) text = e.output;
    });

    const tools = events
      .filter((e) => e.type === "tool.started")
      .map((e) => (e as { tool: string }).tool);
    const segments = parseAgentText(text);
    console.info(
      "[smoke] tools:",
      tools.join(", ") || "none",
      "\n[smoke] segments:",
      segments
        .map((s) => s.kind + ("directive" in s ? `:${s.directive.type}` : ""))
        .join(", "),
      "\n[smoke] reply:\n" + text,
    );

    expect(events.some((e) => e.type === "completed")).toBe(true);
    expect(tools.some((t) => t.includes("vss_search_video"))).toBe(true);
    const matches = segments.find(
      (s) => s.kind === "directive" && s.directive.type === "matches",
    );
    expect(matches, "expected a valid vsg-matches block").toBeDefined();

    // The UI grounds the grid on the tool result in the transcript.
    const grounding = groundingForRun(await hermes.getMessages(sessionId));
    expect(grounding, "expected a vss_search_video result").toBeDefined();
    const keep =
      matches?.kind === "directive" && matches.directive.type === "matches"
        ? matches.directive.data.keep
        : [];
    console.info(
      "[smoke] grounded hits:",
      grounding?.hits.length,
      "query_id:",
      grounding?.queryId ?? "none",
      "keep resolves to:",
      [...(resolveRefs(keep, grounding?.hits ?? []) ?? [])].join(", ") ||
        "nothing (grid shows all hits)",
    );
    expect(grounding!.hits.length).toBeGreaterThan(0);
  }, 900_000);
});
