// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { RunEvent } from "./types";

export interface SseMessage {
  id?: string;
  event?: string;
  data: string;
}

/**
 * Incremental text/event-stream parser. Feed it decoded chunks in any split;
 * it emits one message per blank-line-terminated event. Comment lines
 * (": keepalive", ": stream closed") are ignored.
 */
export function createSseParser(onMessage: (m: SseMessage) => void) {
  let buf = "";
  let id: string | undefined;
  let event: string | undefined;
  let data: string[] = [];

  const dispatch = () => {
    if (data.length) onMessage({ id, event, data: data.join("\n") });
    event = undefined;
    data = [];
  };

  const line = (l: string) => {
    if (l === "") return dispatch();
    if (l.startsWith(":")) return;
    const i = l.indexOf(":");
    const field = i === -1 ? l : l.slice(0, i);
    let value = i === -1 ? "" : l.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") event = value;
    else if (field === "id") id = value;
  };

  return {
    push(chunk: string) {
      buf += chunk;
      let nl: number;
      while ((nl = buf.search(/\r\n|\r|\n/)) !== -1) {
        const l = buf.slice(0, nl);
        const len = buf[nl] === "\r" && buf[nl + 1] === "\n" ? 2 : 1;
        buf = buf.slice(nl + len);
        line(l);
      }
    },
    end() {
      if (buf) line(buf);
      buf = "";
      dispatch();
    },
  };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Map a raw Hermes run event payload to the UI's normalised RunEvent. */
export function toRunEvent(msg: SseMessage): RunEvent | undefined {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(msg.data) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const name = str(d.event) ?? msg.event ?? "";
  const seq = typeof d.seq === "number" ? d.seq : undefined;
  switch (name) {
    case "message.delta":
      return { type: "delta", seq, text: str(d.delta) ?? "" };
    case "reasoning.available":
    case "reasoning.delta":
      return {
        type: "reasoning",
        seq,
        text: str(d.text) ?? str(d.delta) ?? "",
      };
    case "tool.started":
      return {
        type: "tool.started",
        seq,
        tool: str(d.tool) ?? "tool",
        preview: str(d.preview),
      };
    case "tool.completed":
      return {
        type: "tool.completed",
        seq,
        tool: str(d.tool) ?? "tool",
        preview: str(d.preview),
        error: d.error === true || d.is_error === true,
      };
    case "run.completed":
      return {
        type: "completed",
        seq,
        output: str(d.output),
        interrupted: d.interrupted === true,
      };
    case "run.cancelled":
    case "run.stopped":
      return { type: "cancelled", seq };
    case "run.failed":
    case "run.error":
    case "error": {
      const err = d.error;
      const message =
        str(err) ??
        (err && typeof err === "object"
          ? str((err as Record<string, unknown>).message)
          : undefined) ??
        str(d.message) ??
        "The agent run failed.";
      return { type: "failed", seq, error: message };
    }
    default:
      return { type: "other", seq, event: name, data: d };
  }
}

export function isTerminal(e: RunEvent) {
  return (
    e.type === "completed" || e.type === "failed" || e.type === "cancelled"
  );
}

/** Strip the MCP server prefix: mcp__video_search_mcp__vss_search_video -> vss_search_video */
export function shortToolName(tool: string): string {
  const parts = tool.split("__");
  return parts[parts.length - 1] || tool;
}
