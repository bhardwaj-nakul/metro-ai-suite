// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { shortToolName } from "@/adapters/hermes/sse";
import type { HermesMessage, RunEvent } from "@/adapters/hermes/types";
import type { Directive, FeedbackDirective } from "@/protocol/directives";
import type { InstructionContext, Unavailable } from "@/protocol/instructions";
import {
  groundingFromMessage,
  type SearchGrounding,
} from "@/protocol/grounding";
import { extractDirectives, stripDirectives } from "@/protocol/parser";
import { redactUrl, toDatastorePath } from "@/lib/urls";
import { hitKey } from "@/lib/hits";
import { uid } from "@/lib/utils";
import { sightingHit, type LiveSighting } from "./liveTimeline";
import {
  confirmedSightings,
  routeFromSightings,
  splitVerdicts,
  timelineLines,
  type Review,
  type TraceStop,
  type Verdict,
} from "./case";

export type InvestigationPhase =
  "idle" | "searching" | "validating" | "tracing" | "traced" | "reporting";

export interface ToolCallView {
  id: string;
  tool: string;
  name: string;
  args?: string;
  preview?: string;
  status: "running" | "done" | "error";
}

export interface OperatorTurn {
  id: string;
  role: "operator";
  kind: "search" | "feedback" | "report" | "streams";
  /** What the operator sees in the transcript. */
  text: string;
  /** Rest of a long UI-written prompt, shown collapsed under `text`. */
  details?: string;
  /** Exact run input sent to Hermes. */
  input: string;
  image?: { previewUrl: string; imageUrl: string };
  createdAt: number;
}

export interface AgentTurn {
  id: string;
  role: "agent";
  runId?: string;
  text: string;
  reasoning: string;
  tools: ToolCallView[];
  status: "streaming" | "done" | "cancelled" | "failed";
  error?: string;
  createdAt: number;
  /** Rebuilt from session history rather than streamed. */
  replayed?: boolean;
  /** Latest vss_search_video result of this run, read from the transcript. */
  search?: SearchGrounding;
  /** True while the transcript is being fetched after the run. */
  grounding?: boolean;
  /** Set when the transcript could not be read; the grid offers a retry. */
  groundError?: string;
}

export type Turn = OperatorTurn | AgentTurn;

export function newAgentTurn(): AgentTurn {
  return {
    id: uid("agent"),
    role: "agent",
    text: "",
    reasoning: "",
    tools: [],
    status: "streaming",
    createdAt: Date.now(),
  };
}

/** Pure reducer: fold one Hermes run event into the streaming agent turn. */
export function applyRunEvent(t: AgentTurn, ev: RunEvent): AgentTurn {
  switch (ev.type) {
    case "delta":
      return { ...t, text: t.text + ev.text };
    case "reasoning":
      return { ...t, reasoning: t.reasoning + ev.text };
    case "tool.started":
      return {
        ...t,
        tools: [
          ...t.tools,
          {
            id: uid("tool"),
            tool: ev.tool,
            name: shortToolName(ev.tool),
            args: redactUrl(ev.preview),
            status: "running",
          },
        ],
      };
    case "tool.completed": {
      const tools = [...t.tools];
      let i = -1;
      for (let k = tools.length - 1; k >= 0; k--)
        if (tools[k].tool === ev.tool && tools[k].status === "running") {
          i = k;
          break;
        }
      const done: ToolCallView = {
        ...(i >= 0
          ? tools[i]
          : { id: uid("tool"), tool: ev.tool, name: shortToolName(ev.tool) }),
        preview: redactUrl(ev.preview),
        status: ev.error ? "error" : "done",
      };
      if (i >= 0) tools[i] = done;
      else tools.push(done);
      return { ...t, tools };
    }
    case "completed":
      return {
        ...t,
        status: "done",
        // After a dropped stream the final output holds what the deltas missed.
        text:
          ev.output && ev.output.length > t.text.length ? ev.output : t.text,
        tools: closeTools(t.tools),
      };
    case "failed":
      return {
        ...t,
        status: "failed",
        error: ev.error,
        tools: closeTools(t.tools),
      };
    case "cancelled":
      return { ...t, status: "cancelled", tools: closeTools(t.tools) };
    default:
      return t;
  }
}

function closeTools(tools: ToolCallView[]): ToolCallView[] {
  return tools.map((x) =>
    x.status === "running" ? { ...x, status: "done" } : x,
  );
}

/**
 * Phase after an agent reply finished, driven by the directives it emitted.
 * Without a matches block the investigation returns to where it was before
 * the run (e.g. a report keeps the "traced" state).
 */
export function settleAfter(
  text: string,
  before: InvestigationPhase,
): InvestigationPhase {
  const ds = extractDirectives(text);
  if (ds.some((d) => d.type === "matches")) return "validating";
  return before;
}

/** Phase while a run for this kind of operator turn is in flight. */
export function runningPhase(
  kind: OperatorTurn["kind"],
  hasConfirms: boolean,
): InvestigationPhase {
  if (kind === "report") return "reporting";
  if (kind === "streams") return "idle";
  if (kind === "feedback") return hasConfirms ? "tracing" : "searching";
  return "searching";
}

const REPORT_RE =
  /\b(report|handover|hand-over|escalat(?:e|es|ed|ing|ion)|incident (pdf|summary)|write ?up)\b/i;

/**
 * Up to three words between a verb and "camera", none of which puts the
 * camera after someone else ("show me the person on camera 3").
 */
const GAP = String.raw`(?:\s+(?!(?:on|at|in|from|near|by|of|with|for|to|across|between|through|around|which|where|when|who)\b)[\w-]+){0,3}`;

/**
 * Camera management: add/remove/pause/resume/rename a camera, list or show
 * the cameras, or any RTSP URL.
 */
const STREAMS_RE = new RegExp(
  String.raw`rtsps?:\/\/|\b(?:add|remove|delete|pause|resume|rename)\b${GAP}\s+(?:cameras?|streams?|feeds?)(?:_\w+)?\b|\b(?:list|show)\b${GAP}\s+(?:cameras|streams|feeds)\b`,
  "i",
);

/**
 * Split a report request into the line the operator sees and the evidence
 * listing below it (the first paragraph, then everything after it).
 */
export function splitReportPrompt(text: string): {
  text: string;
  details?: string;
} {
  const t = text.trim();
  const i = t.indexOf("\n\n");
  return i < 0
    ? { text: t }
    : { text: t.slice(0, i), details: t.slice(i + 2).trim() || undefined };
}

export function classifyPrompt(
  text: string,
  hasImage: boolean,
): OperatorTurn["kind"] {
  if (!hasImage && STREAMS_RE.test(text)) return "streams";
  if (!hasImage && REPORT_RE.test(text)) return "report";
  return "search";
}

/**
 * Stored VSS query id of the latest search result. Only ids that came from a
 * real tool result count; ids the model wrote are never echoed back to it.
 */
export function activeQueryId(turns: Turn[]): string | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.role === "agent" && t.search?.queryId) return t.search.queryId;
  }
  return undefined;
}

/**
 * Search grounding for the directives of `turnId`: the vss_search_video result
 * of that same reply. Returns the stored object so zustand selectors stay
 * referentially stable.
 */
export function groundingFor(
  turns: Turn[],
  turnId: string,
): SearchGrounding | undefined {
  const t = turns.find((x) => x.id === turnId);
  return t?.role === "agent" ? t.search : undefined;
}

/** Why the transcript could not be read for `turnId`, if it failed. */
export function groundErrorFor(
  turns: Turn[],
  turnId: string,
): string | undefined {
  const t = turns.find((x) => x.id === turnId);
  return t?.role === "agent" ? t.groundError : undefined;
}

/** True while `turnId` may still gain grounding (streaming or fetching it). */
export function groundingPending(turns: Turn[], turnId: string): boolean {
  const t = turns.find((x) => x.id === turnId);
  return t?.role === "agent" && (t.status === "streaming" || !!t.grounding);
}

/** Parsed directives per agent turn; a streaming token only re-parses its turn. */
const directiveCache = new WeakMap<AgentTurn, Directive[]>();

function directivesOf(t: AgentTurn): Directive[] {
  let ds = directiveCache.get(t);
  if (!ds) {
    ds = extractDirectives(t.text);
    directiveCache.set(t, ds);
  }
  return ds;
}

/** Agent turn whose vsg-matches grid an operator feedback turn reviewed. */
export function reviewedTurnId(
  turns: Turn[],
  feedbackIndex: number,
): string | undefined {
  for (let k = feedbackIndex - 1; k >= 0; k--) {
    const t = turns[k];
    if (t.role === "agent" && directivesOf(t).some((d) => d.type === "matches"))
      return t.id;
  }
  return undefined;
}

export function latestDirective<T extends Directive["type"]>(
  turns: Turn[],
  type: T,
): { turnId: string; directive: Extract<Directive, { type: T }> } | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.role !== "agent") continue;
    const ds = directivesOf(t).filter((d) => d.type === type);
    if (ds.length)
      return {
        turnId: t.id,
        directive: ds[ds.length - 1] as Extract<Directive, { type: T }>,
      };
  }
  return undefined;
}

/**
 * Did this reply search? A prompt is classified "search" before
 * it runs, so a finished reply must have a real search result to count; one
 * still running (or being grounded) counts until it says otherwise.
 */
function replySearched(reply: Turn | undefined): boolean {
  if (reply?.role !== "agent") return true;
  return reply.status === "streaming" || !!reply.grounding || !!reply.search;
}

/** Latest operator search turn matching `pick`, newest first. */
function latestSearch(
  turns: Turn[],
  pick: (t: OperatorTurn) => boolean = () => true,
): OperatorTurn | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (
      t.role === "operator" &&
      t.kind === "search" &&
      pick(t) &&
      replySearched(turns[i + 1])
    )
      return t;
  }
  return undefined;
}

/**
 * The investigation's subject photo: the latest image searched with (a crop
 * included). Returns the turn's own object, so selectors stay stable.
 */
export const subjectImageOf = (turns: Turn[]) =>
  latestSearch(turns, (t) => !!t.image)?.image;

/** The latest search prompt: what the investigation is looking for. */
export const subjectTextOf = (turns: Turn[]) => latestSearch(turns)?.text;

/** The vsg-feedback block of an operator run input, if it has one. */
export function feedbackOf(input: string): FeedbackDirective | undefined {
  const fb = extractDirectives(input).find((d) => d.type === "feedback");
  return fb?.type === "feedback" ? fb.data : undefined;
}

/** True for a review that confirmed at least one sighting. */
export const confirmsSightings = (op: OperatorTurn) =>
  op.kind === "feedback" && !!feedbackOf(op.input)?.confirm.length;

export function verdictsFromFeedback(
  fb: FeedbackDirective,
): Record<string, Verdict> {
  const verdicts: Record<string, Verdict> = {};
  fb.confirm.forEach((r) => (verdicts[r] = "confirm"));
  fb.reject.forEach((r) => (verdicts[r] = "reject"));
  return verdicts;
}

/** Sent reviews of a restored transcript, keyed by the grid each one reviewed. */
export function reviewsFromTurns(turns: Turn[]): Record<string, Review> {
  const reviews: Record<string, Review> = {};
  turns.forEach((t, i) => {
    if (t.role !== "operator" || t.kind !== "feedback") return;
    const fb = feedbackOf(t.input);
    const reviewed = reviewedTurnId(turns, i);
    if (!fb || !reviewed) return;
    const verdicts = verdictsFromFeedback(fb);
    reviews[reviewed] = { verdicts, sent: verdicts };
  });
  return reviews;
}

/**
 * The session's route: confirmed sightings, de-duplicated, in time order. A
 * confirmed live sighting is one stop at its start, spanning to its end.
 */
export function routeOf(
  s: { turns: Turn[]; reviews: Record<string, Review> },
  live: readonly LiveSighting[],
): TraceStop[] {
  const confirmed = new Map(
    live.filter((l) => l.confirmed).map((l) => [hitKey(sightingHit(l)), l]),
  );
  const hits = [...confirmed.values()].map(sightingHit);
  return routeFromSightings(confirmedSightings(s.turns, s.reviews, hits)).map(
    (stop) => {
      const l = confirmed.get(hitKey(stop.hit));
      return l && l.count > 1
        ? { ...stop, until: new Date(l.end), detections: l.count }
        : stop;
    },
  );
}

/** Everything Argus is told about the session before a run. */
export function instructionContext(
  c: {
    phase: InvestigationPhase;
    turns: Turn[];
    reviews: Record<string, Review>;
    live: readonly LiveSighting[];
    /** The operator's latest search prompt. */
    subject?: string;
  },
  env: {
    fleet: {
      cameras: { name: string; streamId: string; status: string }[];
      error?: string;
      hasLiveCamera: boolean;
    };
    freePositions: string[] | Unavailable;
    watchingQueryId?: string;
    zone: (tag: string) => string | undefined;
    minScore: number;
    limit: number;
  },
): InstructionContext {
  const grid = latestDirective(c.turns, "matches")?.turnId;
  const { confirm, reject } = splitVerdicts(
    grid ? c.reviews[grid]?.sent : undefined,
  );
  const { fleet } = env;
  return {
    phase: c.phase,
    // Statuses from before a failed refresh would be stale.
    cameras: fleet.error
      ? { unavailable: `camera status unavailable: ${fleet.error}` }
      : fleet.cameras.map((x) => `${x.name} (${x.streamId}, ${x.status})`),
    freePositions: env.freePositions,
    hasLiveCamera: !fleet.error && fleet.hasLiveCamera,
    watching: env.watchingQueryId,
    subject: c.subject?.trim() || undefined,
    activeQueryId: activeQueryId(c.turns),
    confirmed: confirm,
    rejected: reject,
    sightings: timelineLines(routeOf(c, c.live), env.zone),
    minScore: env.minScore,
    limit: env.limit,
  };
}

export function describeFeedback(confirm: string[], reject: string[]): string {
  const parts: string[] = [];
  if (confirm.length) parts.push(`Confirmed ${confirm.join(", ")}.`);
  if (reject.length)
    parts.push(`Marked ${reject.join(", ")} as false positives.`);
  if (!confirm.length) parts.push("None are the right person.");
  return parts.join(" ");
}

/**
 * Rebuild a transcript from Hermes session history. Consecutive assistant and
 * tool messages (one run) fold into a single agent turn.
 */
export function turnsFromMessages(messages: HermesMessage[]): Turn[] {
  const turns: Turn[] = [];
  let agent: AgentTurn | undefined;
  for (const m of messages) {
    const ts = m.timestamp ? m.timestamp * 1000 : Date.now();
    if (m.role === "user") {
      agent = undefined;
      const ds = extractDirectives(m.content);
      const fb = feedbackOf(m.content);
      const ctx = ds.find((d) => d.type === "context");
      const prose = stripDirectives(m.content);
      const kind: OperatorTurn["kind"] = fb
        ? "feedback"
        : classifyPrompt(
            prose,
            !!(ctx?.type === "context" && ctx.data.image_url),
          );
      const imageUrl = ctx?.type === "context" ? ctx.data.image_url : undefined;
      const preview = imageUrl ? toDatastorePath(imageUrl) : undefined;
      const shown =
        kind === "report" ? splitReportPrompt(prose) : { text: prose };
      turns.push({
        id: uid("op"),
        role: "operator",
        kind,
        ...shown,
        ...(fb && { text: describeFeedback(fb.confirm, fb.reject) }),
        input: m.content,
        image:
          imageUrl && preview ? { imageUrl, previewUrl: preview } : undefined,
        createdAt: ts,
      });
      continue;
    }
    if (m.role === "system") continue;
    if (!agent) {
      agent = {
        ...newAgentTurn(),
        status: "done",
        replayed: true,
        createdAt: ts,
      };
      turns.push(agent);
    }
    if (m.role === "assistant") {
      if (m.content.trim())
        agent.text = agent.text ? `${agent.text}\n\n${m.content}` : m.content;
      for (const c of m.toolCalls ?? [])
        agent.tools.push({
          id: c.id ?? uid("tool"),
          tool: c.name,
          name: shortToolName(c.name),
          args: redactUrl(c.arguments),
          status: "done",
        });
    } else if (m.role === "tool") {
      agent.search = groundingFromMessage(m) ?? agent.search;
      const t =
        agent.tools.find((x) => m.toolCallId && x.id === m.toolCallId) ??
        [...agent.tools].reverse().find((x) => !x.preview);
      // Redact before truncating so a cut can't leave a partial credential.
      if (t) t.preview = redactUrl(m.content)?.slice(0, 500);
    }
  }
  return turns;
}

/** Replay phase across a restored transcript. */
export function phaseFromTurns(turns: Turn[]): InvestigationPhase {
  let settled: InvestigationPhase = "idle";
  let op: OperatorTurn | undefined;
  for (const t of turns) {
    if (t.role === "operator") op = t;
    // Same rule as the end of a live run: a confirming review traces the route.
    else if (op && confirmsSightings(op)) settled = "traced";
    else settled = settleAfter(t.text, settled);
  }
  return settled;
}
