// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import {
  DIRECTIVE_SCHEMAS,
  isKnownFence,
  type Directive,
  type DirectiveType,
} from "./directives";

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "directive"; directive: Directive; raw: string }
  | { kind: "invalid"; fence: string; raw: string; error: string }
  | { kind: "pending"; fence: string };

/** A vsg-* fence opener; the name may still be incomplete while streaming. */
const OPEN_RE = /```[ \t]*(vsg-[a-z-]*)/g;
/** A ``` that opens the next vsg-* block rather than closing this one. */
const OPENER_AT = /^```[ \t]*vsg-/;

/**
 * JSON.parse with the repairs small models most often need: smart quotes,
 * trailing commas, // comment lines and prose around the object.
 */
export function lenientJson(raw: string): unknown {
  const s = raw.trim();
  try {
    return JSON.parse(s);
  } catch {
    // fall through to repairs
  }
  let fixed = s
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1");
  const a = fixed.indexOf("{");
  const b = fixed.lastIndexOf("}");
  if (a >= 0 && b > a) fixed = fixed.slice(a, b + 1);
  return JSON.parse(fixed);
}

function parseBlock(fence: string, body: string): Segment {
  if (!isKnownFence(fence)) return { kind: "text", text: "" };
  const { type, schema } = DIRECTIVE_SCHEMAS[fence];
  let json: unknown;
  try {
    json = lenientJson(body);
  } catch (e) {
    return {
      kind: "invalid",
      fence,
      raw: body,
      error: `Not valid JSON: ${(e as Error).message}`,
    };
  }
  const res = schema.safeParse(json);
  if (!res.success) {
    return {
      kind: "invalid",
      fence,
      raw: body,
      error: res.error.issues
        .map((i) => `${i.path.join(".") || fence}: ${i.message}`)
        .join("; "),
    };
  }
  return {
    kind: "directive",
    directive: { type, data: res.data } as Directive,
    raw: body,
  };
}

/** Remove model reasoning that leaked into content. */
function stripThinking(text: string, streaming: boolean): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  if (streaming) t = t.replace(/<think>[\s\S]*$/, "");
  return t;
}

function pushText(out: Segment[], text: string) {
  const t = text.replace(/^\s*\n|\n\s*$/g, "");
  if (t.trim()) out.push({ kind: "text", text: t });
}

/**
 * End (exclusive) of the JSON object that starts at the first non-blank
 * character at or after `from`, or -1 if there is none before `limit`.
 */
function jsonEnd(s: string, from: number, limit: number): number {
  const a = s.slice(from, limit).search(/\S/);
  if (a < 0 || s[from + a] !== "{") return -1;
  let depth = 0;
  let str = false;
  let esc = false;
  for (let i = from + a; i < limit; i++) {
    const c = s[i];
    if (str) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') str = false;
    } else if (c === '"') str = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Split agent content into prose and directive segments.
 * - Known vsg-* fences are validated; failures become "invalid" segments (rendered
 *   as a "couldn't render" chip with the raw block).
 * - Unknown vsg-* fences (e.g. reserved vsg-tick) are dropped.
 * - The body may start on the fence line (```vsg-status {...}```).
 * - While streaming, an unterminated vsg-* fence at the end becomes a "pending"
 *   segment so raw JSON never flashes on screen.
 * - A block that is never closed ends at its JSON object (or at the next vsg-*
 *   fence), so the prose after it still shows.
 */
export function parseAgentText(
  text: string,
  opts: { streaming?: boolean } = {},
): Segment[] {
  const streaming = !!opts.streaming;
  const src = stripThinking(text ?? "", streaming);
  const out: Segment[] = [];
  let last = 0;
  for (;;) {
    OPEN_RE.lastIndex = last;
    const m = OPEN_RE.exec(src);
    if (!m) break;
    pushText(out, src.slice(last, m.index));
    const fence = m[1];
    const head = m.index + m[0].length;
    // The rest of the fence line: an info string, or the body itself.
    const nl = src.indexOf("\n", head);
    const lineEnd = nl < 0 ? src.length : nl;
    const sameLine = src.indexOf("```", head);
    if (sameLine >= 0 && sameLine < lineEnd) {
      const seg = parseBlock(fence, src.slice(head, sameLine));
      if (seg.kind !== "text") out.push(seg);
      last = sameLine + 3;
      continue;
    }
    const line = src.slice(head, lineEnd);
    const lead = line.trim().startsWith("{") ? line : "";
    const close = nl < 0 ? -1 : src.indexOf("```", nl);
    if (close >= 0 && !OPENER_AT.test(src.slice(close))) {
      const seg = parseBlock(fence, lead + src.slice(nl, close));
      if (seg.kind !== "text") out.push(seg);
      last = close + 3;
      continue;
    }
    // Never closed. `close`, if any, opens the next vsg-* block.
    const limit = close >= 0 ? close : src.length;
    if (streaming && close < 0) {
      out.push({ kind: "pending", fence: fence || "vsg-" });
      return out;
    }
    const bodyStart = lead ? head : lineEnd;
    const end = jsonEnd(src, bodyStart, limit);
    if (end >= 0) {
      const seg = parseBlock(fence, src.slice(bodyStart, end));
      if (seg.kind !== "text") out.push(seg);
      last = end;
      continue;
    }
    if (isKnownFence(fence))
      out.push({
        kind: "invalid",
        fence,
        raw: src.slice(bodyStart, limit).trim(),
        error: "Block was not closed",
      });
    last = limit;
  }
  let rest = src.slice(last);
  if (streaming) rest = rest.replace(/`{1,3}[a-z-]*$/, "");
  pushText(out, rest);
  return out;
}

export function extractDirectives(text: string): Directive[] {
  return parseAgentText(text)
    .filter(
      (s): s is Extract<Segment, { kind: "directive" }> =>
        s.kind === "directive",
    )
    .map((s) => s.directive);
}

export function lastDirective<T extends DirectiveType>(
  text: string,
  type: T,
): Extract<Directive, { type: T }> | undefined {
  const all = extractDirectives(text).filter((d) => d.type === type);
  return all[all.length - 1] as Extract<Directive, { type: T }> | undefined;
}

/** Prose only, with every vsg-* block removed (used for operator turns). */
export function stripDirectives(text: string): string {
  return parseAgentText(text)
    .filter((s) => s.kind === "text")
    .map((s) => (s as { text: string }).text)
    .join("\n\n")
    .trim();
}
