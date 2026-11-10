// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

/**
 * VSG directive protocol v1.
 *
 * Argus (the Hermes agent) embeds small fenced JSON blocks in its replies:
 *
 *   ```vsg-matches
 *   {"v":1,"keep":["m1","m3"],"note":"…"}
 *   ```
 *
 * Directives carry references only (m<rank> refs); the UI reads the hits from
 * the vss_search_video result in the session transcript (see grounding.ts). Keep this file in sync with
 * hermes-skills/virtual-security-guard/references/directive-protocol.md.
 */
export const PROTOCOL_VERSION = 1;

/** Accept 1 or "1"; anything else is a version we do not understand. */
const version = z
  .union([z.literal(1), z.literal("1")])
  .optional()
  .transform(() => 1 as const);

/** m<rank> where rank is the 1-based position in GET /manager/search/:id results. */
export const matchRef = z
  .string()
  .trim()
  .regex(/^m\d+$/i, "expected a match ref like m3")
  .transform((s) => s.toLowerCase());

/**
 * Agent-supplied ref: m<rank> preferred, but a video id or `<video_id>@<start_s>`
 * is tolerated (small models copy ids from the tool output). Resolved against
 * the hits with lib/hits.ts#resolveRefs; unresolvable refs are ignored.
 */
export const looseRef = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .transform((s) => (/^m\d+$/i.test(s) ? s.toLowerCase() : s));

const refList = z
  .array(z.union([looseRef, z.number().int().positive()]))
  .optional()
  .default([])
  .transform((xs) => xs.map((x) => (typeof x === "number" ? `m${x}` : x)));

export const phaseSchema = z.enum([
  "search",
  "validate",
  "trace",
  "report",
  "idle",
]);

export const statusDirective = z.object({
  v: version,
  phase: phaseSchema,
  message: z.string().optional(),
});

/**
 * `{"v":1,"keep":["m1"],"note":"…"}`: refs into the vss_search_video result of
 * the same reply, which is where the UI reads the hits from (grounding.ts).
 * Older fields (`vss_query_id`, inline `matches`) are ignored.
 */
export const matchesDirective = z.object({
  v: version,
  keep: refList,
  note: z.string().optional(),
  notes: z.record(z.string(), z.string()).optional().default({}),
});

export const reportPreset = z.enum(["handover", "escalation", "brief"]);
export const confidence = z.enum(["low", "medium", "high"]);

export const reportDirective = z.object({
  v: version,
  title: z.string().min(1).max(160),
  preset: reportPreset.default("handover"),
  summary: z.string().default(""),
  subject: z.string().default(""),
  timeline: z
    .array(
      z.object({
        ref: z.string().optional(),
        note: z.string().default(""),
      }),
    )
    .default([]),
  observations: z.array(z.string()).default([]),
  actions: z.array(z.string()).default([]),
  confidence: confidence.default("medium"),
  vss_query_id: z.string().optional(),
});

/** UI -> agent: operator review verdicts. */
export const feedbackDirective = z.object({
  v: version,
  vss_query_id: z.string().optional(),
  confirm: z.array(matchRef).default([]),
  reject: z.array(matchRef).default([]),
});

/** UI -> agent: structured search context attached to an operator prompt. */
export const contextDirective = z.object({
  v: version,
  image_url: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export type StatusDirective = z.infer<typeof statusDirective>;
export type MatchesDirective = z.infer<typeof matchesDirective>;
export type ReportDirective = z.infer<typeof reportDirective>;
export type FeedbackDirective = z.infer<typeof feedbackDirective>;
export type ContextDirective = z.infer<typeof contextDirective>;

export type Directive =
  | { type: "status"; data: StatusDirective }
  | { type: "matches"; data: MatchesDirective }
  | { type: "report"; data: ReportDirective }
  | { type: "feedback"; data: FeedbackDirective }
  | { type: "context"; data: ContextDirective };

export type DirectiveType = Directive["type"];

/** Fence info-string -> schema. Other vsg-* fences (e.g. the retired vsg-track) are dropped. */
export const DIRECTIVE_SCHEMAS = {
  "vsg-status": { type: "status", schema: statusDirective },
  "vsg-matches": { type: "matches", schema: matchesDirective },
  "vsg-report": { type: "report", schema: reportDirective },
  "vsg-feedback": { type: "feedback", schema: feedbackDirective },
  "vsg-context": { type: "context", schema: contextDirective },
} as const;

export type DirectiveFence = keyof typeof DIRECTIVE_SCHEMAS;

export function isKnownFence(name: string): name is DirectiveFence {
  return Object.prototype.hasOwnProperty.call(DIRECTIVE_SCHEMAS, name);
}
