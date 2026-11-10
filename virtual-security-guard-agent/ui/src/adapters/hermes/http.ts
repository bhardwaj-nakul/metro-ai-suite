// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { env } from "@/config/env";
import { parseEnvelope, readBody, unexpectedBody } from "../response";
import { createSseParser, isTerminal, toRunEvent } from "./sse";
import {
  HermesError,
  type HermesAdapter,
  type HermesMessage,
  type HermesRunStatus,
  type HermesSession,
  type HermesToolCall,
  type RunEvent,
  type StartRunRequest,
} from "./types";

type Json = Record<string, unknown>;

async function request(
  base: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = await readBody(res);
  if (!res.ok) {
    const err = (body as Json | undefined)?.error;
    const msg =
      (err && typeof err === "object" && (err as Json).message) ||
      (typeof err === "string" ? err : undefined) ||
      `Hermes ${res.status} ${res.statusText}`;
    throw new HermesError(String(msg), res.status);
  }
  if (typeof body === "string")
    throw new HermesError(unexpectedBody("Hermes", body), res.status);
  return body;
}

const expect = <S extends z.ZodType>(schema: S, body: unknown, what: string) =>
  parseEnvelope(schema, body, `Hermes ${what}`, (m) => new HermesError(m));

const optional = <S extends z.ZodType>(s: S) => s.nullish().catch(undefined);

const sessionSchema = z.looseObject({
  id: z.string().min(1),
  title: optional(z.string()),
  started_at: optional(z.number()),
  last_active: optional(z.number()),
  preview: optional(z.string()),
  message_count: optional(z.number()),
});

const listSchema = z.looseObject({ data: z.array(z.looseObject({})) });

const ROLES = ["user", "assistant", "tool", "system"] as const;

function toSession(raw: unknown): HermesSession {
  const s = expect(sessionSchema, raw, "session");
  return {
    id: s.id,
    title: s.title ?? s.id,
    startedAt: s.started_at ?? undefined,
    lastActive: s.last_active ?? undefined,
    preview: s.preview ?? undefined,
    messageCount: s.message_count ?? undefined,
  };
}

function contentToText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c))
    return c
      .map((p) =>
        typeof p === "string"
          ? p
          : p && typeof p === "object" && typeof (p as Json).text === "string"
            ? ((p as Json).text as string)
            : "",
      )
      .join("");
  return "";
}

const wrappedCalls = z.object({
  calls: z
    .array(z.looseObject({ name: z.string().min(1), arguments: z.unknown() }))
    .min(1),
});

/**
 * Hermes stores MCP calls under its `tool_call` meta-tool, with the real
 * tools in its arguments; live run events already name the real tool. The
 * first inner call keeps the id its result refers to. A wrapper whose
 * arguments don't parse stays as it is.
 */
function unwrapToolCall(call: HermesToolCall): HermesToolCall[] {
  let args: unknown;
  try {
    args = JSON.parse(call.arguments ?? "");
  } catch {
    return [call];
  }
  const parsed = wrappedCalls.safeParse(args);
  if (!parsed.success) return [call];
  return parsed.data.calls.map((c, i) => ({
    id: i === 0 ? call.id : undefined,
    name: c.name,
    arguments: JSON.stringify(c.arguments ?? {}),
  }));
}

/** A transcript message, or undefined for a role the UI doesn't show. */
function toMessage(m: Json, i: number): HermesMessage | undefined {
  const role = ROLES.find((r) => r === m.role);
  if (!role) return undefined;
  const calls = Array.isArray(m.tool_calls) ? (m.tool_calls as Json[]) : [];
  return {
    id: String(m.id ?? i),
    role,
    content: contentToText(m.content),
    toolCalls: calls.flatMap((c) => {
      const fn = (c.function ?? {}) as Json;
      const call: HermesToolCall = {
        id: typeof c.id === "string" ? c.id : undefined,
        name: String(fn.name ?? c.name ?? "tool"),
        arguments: typeof fn.arguments === "string" ? fn.arguments : undefined,
      };
      return call.name === "tool_call" ? unwrapToolCall(call) : [call];
    }),
    toolName: typeof m.tool_name === "string" ? m.tool_name : undefined,
    toolCallId: typeof m.tool_call_id === "string" ? m.tool_call_id : undefined,
    timestamp: typeof m.timestamp === "number" ? m.timestamp : undefined,
  };
}

const MAX_RECONNECTS = 3;

/** A run's `error`: a string or an `{message}` object. */
function errorText(e: unknown): string | undefined {
  if (typeof e === "string") return e || undefined;
  if (e && typeof e === "object" && typeof (e as Json).message === "string")
    return (e as Json).message as string;
  return e == null ? undefined : JSON.stringify(e);
}

/** Resolves after `ms`, or at once when `signal` aborts. */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal?.addEventListener("abort", done);
  });
}

/**
 * Hermes API client. All calls go to the same-origin `/hermes` prefix; the
 * nginx BFF (or Vite dev proxy) adds the bearer token, so no secret ever
 * reaches the browser.
 */
export function createHttpHermes(base: string = env.hermesBase): HermesAdapter {
  /**
   * Read one connection of a run's event stream. `cursor` is updated as events
   * arrive, so a reconnect after a dropped connection resumes where it broke.
   */
  async function readStream(
    runId: string,
    onEvent: (e: RunEvent) => void,
    signal: AbortSignal | undefined,
    cursor: { lastId?: string; lastSeq?: number },
  ): Promise<boolean> {
    const res = await fetch(
      `${base}/v1/runs/${encodeURIComponent(runId)}/events`,
      {
        headers: {
          Accept: "text/event-stream",
          ...(cursor.lastId ? { "Last-Event-ID": cursor.lastId } : {}),
        },
        signal,
      },
    );
    if (!res.ok || !res.body)
      throw new HermesError(`Event stream failed (${res.status})`, res.status);
    let terminal = false;
    const parser = createSseParser((msg) => {
      if (msg.id) cursor.lastId = msg.id;
      const ev = toRunEvent(msg);
      if (!ev) return;
      // A server that replays from the start must not duplicate text.
      if (ev.seq !== undefined) {
        if (cursor.lastSeq !== undefined && ev.seq <= cursor.lastSeq) return;
        cursor.lastSeq = ev.seq;
      }
      if (isTerminal(ev)) terminal = true;
      onEvent(ev);
    });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.push(value);
        if (terminal) break;
      }
      parser.end();
    } finally {
      reader.releaseLock();
    }
    return terminal;
  }

  async function runStatus(
    runId: string,
    signal?: AbortSignal,
  ): Promise<HermesRunStatus> {
    const body = expect(
      z.looseObject({
        status: z.string(),
        output: optional(z.string()),
        error: optional(z.unknown()),
      }),
      await request(base, `/v1/runs/${encodeURIComponent(runId)}`, { signal }),
      "run status",
    );
    return {
      status: body.status,
      output: body.output ?? undefined,
      error: errorText(body.error),
    };
  }

  return {
    async health() {
      try {
        const res = await fetch(`${base}/health`, { cache: "no-store" });
        return res.ok;
      } catch {
        return false;
      }
    },

    async createSession(title) {
      // Hermes requires unique titles; repeat prompts get " (2)", " (3)", ...
      for (let n = 1; ; n++) {
        const t = n === 1 ? title : `${title} (${n})`;
        try {
          const body = expect(
            z.looseObject({ session: z.unknown() }),
            await request(base, "/api/sessions", {
              method: "POST",
              body: JSON.stringify({ title: t }),
            }),
            "session",
          );
          return toSession(body.session ?? body);
        } catch (e) {
          if (n >= 20 || !/already in use/i.test((e as Error).message)) throw e;
        }
      }
    },

    async listSessions({ limit = 50, offset = 0 } = {}) {
      const body = expect(
        listSchema.extend({ has_more: optional(z.boolean()) }),
        await request(base, `/api/sessions?limit=${limit}&offset=${offset}`),
        "session list",
      );
      return {
        sessions: body.data.map(toSession),
        hasMore: !!body.has_more,
      };
    },

    async getSession(sessionId) {
      const body = expect(
        z.looseObject({ session: z.unknown() }),
        await request(base, `/api/sessions/${encodeURIComponent(sessionId)}`),
        "session",
      );
      return toSession(body.session);
    },

    async getMessages(sessionId) {
      const body = expect(
        listSchema,
        await request(
          base,
          `/api/sessions/${encodeURIComponent(sessionId)}/messages?inline_images=false`,
        ),
        "message list",
      );
      return body.data.map(toMessage).filter((m): m is HermesMessage => !!m);
    },

    async deleteSession(sessionId) {
      await request(base, `/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
    },

    async startRun(req: StartRunRequest) {
      const body = expect(
        z.looseObject({ run_id: z.string().min(1) }),
        await request(base, "/v1/runs", {
          method: "POST",
          body: JSON.stringify({
            input: req.input,
            ...(req.sessionId ? { session_id: req.sessionId } : {}),
            ...(req.instructions ? { instructions: req.instructions } : {}),
          }),
        }),
        "run",
      );
      return { runId: body.run_id };
    },

    async streamRun(runId, onEvent, signal) {
      const cursor: { lastId?: string; lastSeq?: number } = {};
      for (let attempt = 0; attempt <= MAX_RECONNECTS; attempt++) {
        if (signal?.aborted) return;
        try {
          if (await readStream(runId, onEvent, signal, cursor)) return;
        } catch (e) {
          if (signal?.aborted) return;
          if (attempt === MAX_RECONNECTS) throw e;
        }
        // Stream closed without a terminal event: check the run before retrying.
        // A failed status check just means "retry the stream".
        let status: HermesRunStatus | undefined;
        try {
          status = await runStatus(runId, signal);
        } catch {
          // fall through to the retry
        }
        const st = status?.status;
        if (st === "completed") {
          onEvent({ type: "completed", output: status?.output });
          return;
        }
        if (st === "cancelled") return onEvent({ type: "cancelled" });
        if (st === "failed" || st === "interrupted") {
          return onEvent({
            type: "failed",
            error: status?.error ?? "The agent run failed.",
          });
        }
        await abortableSleep(500 * (attempt + 1), signal);
      }
      if (signal?.aborted) return;
      onEvent({ type: "failed", error: "Lost connection to the agent." });
    },

    getRun: (runId) => runStatus(runId),

    async stopRun(runId) {
      await request(base, `/v1/runs/${encodeURIComponent(runId)}/stop`, {
        method: "POST",
      });
    },
  };
}
