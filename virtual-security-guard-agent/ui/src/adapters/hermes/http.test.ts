// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpHermes } from "./http";
import type { RunEvent } from "./types";

const sse = (id: number, data: object) =>
  `id: ${id}\ndata: ${JSON.stringify(data)}\n\n`;

/** A response body that sends `chunks`, then fails like a dropped connection. */
function droppingBody(chunks: string[]) {
  const queue = [...chunks];
  return new ReadableStream<Uint8Array>({
    pull(c) {
      const next = queue.shift();
      if (next) c.enqueue(new TextEncoder().encode(next));
      else c.error(new TypeError("network error"));
    },
  });
}

describe("streamRun", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resumes after a dropped connection without repeating events", async () => {
    const first = [
      sse(1, { event: "message.delta", seq: 1, delta: "Hel" }),
      sse(2, { event: "message.delta", seq: 2, delta: "lo" }),
    ];
    // The server replays from the start; seq filters the repeats.
    const second = first.join("") + sse(3, { event: "run.completed", seq: 3 });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(droppingBody(first)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "running" })),
      )
      .mockResolvedValueOnce(new Response(second));
    vi.stubGlobal("fetch", fetch);

    const events: RunEvent[] = [];
    await createHttpHermes("/h").streamRun("r1", (e) => events.push(e));

    const text = events.map((e) => (e.type === "delta" ? e.text : "")).join("");
    expect(text).toBe("Hello");
    expect(events.at(-1)?.type).toBe("completed");
    const resume = fetch.mock.calls[2][1] as RequestInit;
    expect((resume.headers as Record<string, string>)["Last-Event-ID"]).toBe(
      "2",
    );
  });

  it("stops waiting to reconnect as soon as the run is aborted", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(droppingBody([])))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "running" })),
      );
    vi.stubGlobal("fetch", fetch);
    const ac = new AbortController();
    const done = createHttpHermes("/h").streamRun("r1", () => {}, ac.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const t0 = Date.now();
    ac.abort();
    await done;
    expect(Date.now() - t0).toBeLessThan(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports an interrupted run instead of reconnecting", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(droppingBody([])))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ status: "interrupted", error: "Gateway restarted" }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const events: RunEvent[] = [];
    await createHttpHermes("/h").streamRun("r1", (e) => events.push(e));
    expect(events).toEqual([{ type: "failed", error: "Gateway restarted" }]);
  });
});

describe("sessions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pages the session list with offset and has_more", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: "s1", title: "VSG · a" }],
          has_more: true,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const page = await createHttpHermes("/h").listSessions({
      limit: 100,
      offset: 200,
    });
    expect(fetch.mock.calls[0][0]).toBe("/h/api/sessions?limit=100&offset=200");
    expect(page).toEqual({
      sessions: [expect.objectContaining({ id: "s1", title: "VSG · a" })],
      hasMore: true,
    });
  });

  it("reads one session's title from GET /api/sessions/{id}", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ session: { id: "s 1", title: "VSG · lobby" } }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const s = await createHttpHermes("/h").getSession("s 1");
    expect(fetch.mock.calls[0][0]).toBe("/h/api/sessions/s%201");
    expect(s.title).toBe("VSG · lobby");
  });

  it("names a transcript's tool_call wrapper after the tools it called", async () => {
    const call = (id: string, name: string, args: string) => ({
      id,
      function: { name, arguments: args },
    });
    const vss = "mcp__video_search_summarization__vss_";
    const fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              role: "assistant",
              content: "",
              tool_calls: [
                call(
                  "c1",
                  "tool_call",
                  JSON.stringify({
                    calls: [
                      { name: `${vss}list_streams`, arguments: {} },
                      { name: `${vss}list_tags`, arguments: {} },
                    ],
                  }),
                ),
                call("c2", "tool_call", "not json"),
                call("c3", "skill_view", '{"name":"x"}'),
              ],
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const [m] = await createHttpHermes("/h").getMessages("s1");
    expect(m.toolCalls?.map((c) => [c.id, c.name])).toEqual([
      ["c1", `${vss}list_streams`],
      [undefined, `${vss}list_tags`],
      ["c2", "tool_call"],
      ["c3", "skill_view"],
    ]);
  });
});
