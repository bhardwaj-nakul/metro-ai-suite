// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import {
  MOCK_REPORT,
  scriptedReply,
  type ScriptedReply,
} from "@/fixtures/argus";
import { serializeFeedback } from "@/protocol/feedback";
import { uid } from "@/lib/utils";
import {
  HermesError,
  type HermesAdapter,
  type HermesMessage,
  type HermesSession,
  type RunEvent,
} from "./types";

interface MockRun {
  id: string;
  input: string;
  sessionId?: string;
  cancelled: boolean;
  done: boolean;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });

/** Transcript of one run as Hermes stores it: prompt, tool calls, results, reply. */
function runMessages(
  input: string,
  reply: Pick<ScriptedReply, "tools"> & { text: string },
  at: number,
): HermesMessage[] {
  const calls = reply.tools.map((t) => ({
    id: uid("call"),
    name: t.tool,
    arguments: t.args,
  }));
  const out: HermesMessage[] = [
    { id: uid("msg"), role: "user", content: input, timestamp: at },
  ];
  if (calls.length)
    out.push(
      {
        id: uid("msg"),
        role: "assistant",
        content: "",
        toolCalls: calls,
        timestamp: at,
      },
      ...reply.tools.map((t, i): HermesMessage => ({
        id: uid("msg"),
        role: "tool",
        content: t.result ?? t.preview,
        toolName: t.tool,
        toolCallId: calls[i].id,
        timestamp: at,
      })),
    );
  out.push({
    id: uid("msg"),
    role: "assistant",
    content: reply.text,
    timestamp: at,
  });
  return out;
}

function seedPastSession(): {
  session: HermesSession;
  messages: HermesMessage[];
} {
  const t0 = Date.now() / 1000 - 3 * 3600;
  const prompts: [string, number][] = [
    ["Find a person in a blue jacket on Level 4", 0],
    [
      serializeFeedback({
        queryId: "mock-q-search",
        confirm: ["m1"],
        reject: ["m2", "m3", "m4", "m5", "m6"],
      }),
      180,
    ],
    ["Write a handover report", 500],
  ];
  const messages = prompts.flatMap(([input, dt]) =>
    runMessages(input, scriptedReply(input), t0 + dt),
  );
  return {
    session: {
      id: "mock_session_past",
      title: "VSG · Person in blue jacket, Level 4",
      startedAt: t0,
      lastActive: t0 + 600,
      preview: MOCK_REPORT.summary.slice(0, 80),
      messageCount: messages.length,
    },
    messages,
  };
}

/** Scripted Hermes: replays Argus' search → validate → trace → report loop. */
export function createMockHermes(
  opts: { delayMs?: number } = {},
): HermesAdapter {
  const delay = opts.delayMs ?? 18;
  const sessions = new Map<
    string,
    { session: HermesSession; messages: HermesMessage[] }
  >();
  const past = seedPastSession();
  sessions.set(past.session.id, past);
  const runs = new Map<string, MockRun>();

  return {
    async health() {
      return true;
    },
    async createSession(title) {
      const now = Date.now() / 1000;
      const session: HermesSession = {
        id: uid("mock_session"),
        title,
        startedAt: now,
        lastActive: now,
        messageCount: 0,
      };
      sessions.set(session.id, { session, messages: [] });
      return session;
    },
    async listSessions({ limit = 50, offset = 0 } = {}) {
      const all = [...sessions.values()]
        .map((s) => s.session)
        .sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));
      return {
        sessions: all.slice(offset, offset + limit),
        hasMore: offset + limit < all.length,
      };
    },
    async getSession(id) {
      const s = sessions.get(id);
      if (!s) throw new HermesError(`Session not found: ${id}`, 404);
      return s.session;
    },
    async getMessages(id) {
      return sessions.get(id)?.messages ?? [];
    },
    async deleteSession(id) {
      sessions.delete(id);
    },
    async startRun(req) {
      const id = uid("mock_run");
      runs.set(id, {
        id,
        input: req.input,
        sessionId: req.sessionId,
        cancelled: false,
        done: false,
      });
      return { runId: id };
    },
    async streamRun(runId, onEvent: (e: RunEvent) => void, signal) {
      const run = runs.get(runId);
      if (!run) return onEvent({ type: "failed", error: "Unknown run" });
      const reply = scriptedReply(run.input);
      let seq = 0;
      const live = () => !run.cancelled && !signal?.aborted;
      for (const t of reply.tools) {
        await sleep(delay * 10, signal);
        if (!live()) break;
        onEvent({
          type: "tool.started",
          seq: ++seq,
          tool: t.tool,
          preview: t.args,
        });
        await sleep(delay * 25, signal);
        if (!live()) break;
        onEvent({
          type: "tool.completed",
          seq: ++seq,
          tool: t.tool,
          preview: t.preview,
        });
      }
      let out = "";
      const chunks = reply.text.match(/[\s\S]{1,14}/g) ?? [];
      for (const c of chunks) {
        if (!live()) break;
        await sleep(delay, signal);
        out += c;
        onEvent({ type: "delta", seq: ++seq, text: c });
      }
      if (run.cancelled) {
        onEvent({ type: "cancelled", seq: ++seq });
      } else if (!signal?.aborted) {
        onEvent({ type: "completed", seq: ++seq, output: out });
      }
      run.done = true;
      const s = run.sessionId ? sessions.get(run.sessionId) : undefined;
      if (s) {
        const now = Date.now() / 1000;
        s.messages.push(
          ...runMessages(run.input, { tools: reply.tools, text: out }, now),
        );
        s.session.lastActive = now;
        s.session.messageCount = s.messages.length;
      }
    },
    async getRun(runId) {
      const run = runs.get(runId);
      if (!run) throw new HermesError(`Run not found: ${runId}`, 404);
      return {
        status: run.done
          ? run.cancelled
            ? "cancelled"
            : "completed"
          : "running",
      };
    },
    async stopRun(runId) {
      const run = runs.get(runId);
      if (run) run.cancelled = true;
    },
  };
}
