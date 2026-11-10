// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { z } from "zod";
import {
  PROTOCOL_VERSION,
  type contextDirective,
  type feedbackDirective,
} from "./directives";

/** Blocks the UI writes, typed by the schemas Argus's replies are read with. */
interface UiBlocks {
  "vsg-context": Omit<z.input<typeof contextDirective>, "v">;
  "vsg-feedback": Omit<z.input<typeof feedbackDirective>, "v">;
}

/** Prompt used when the operator sends only a photo. */
export const IMAGE_ONLY_PROMPT =
  "Find matches for this photo in the recorded footage.";

function block<F extends keyof UiBlocks>(
  fence: F,
  payload: UiBlocks[F],
): string {
  const clean = Object.fromEntries(
    Object.entries(payload).filter(
      ([, v]) =>
        v !== undefined &&
        v !== null &&
        v !== "" &&
        !(Array.isArray(v) && v.length === 0),
    ),
  );
  return [
    "```" + fence,
    JSON.stringify({ v: PROTOCOL_VERSION, ...clean }),
    "```",
  ].join("\n");
}

export interface SearchRequest {
  text: string;
  imageUrl?: string;
  limit?: number;
}

/** Operator prompt + optional vsg-context block, sent as the Hermes run input. */
export function buildSearchInput(req: SearchRequest): string {
  const prose = req.text.trim() || (req.imageUrl ? IMAGE_ONLY_PROMPT : "");
  if (!req.imageUrl && !req.limit) return prose;
  return [
    prose,
    "",
    block("vsg-context", {
      image_url: req.imageUrl,
      limit: req.limit,
    }),
  ].join("\n");
}

export interface ReviewFeedback {
  queryId?: string;
  confirm: string[];
  reject: string[];
  /** ref -> short clip label (camera, clip, offset) for the prose summary. */
  labels?: Record<string, string>;
}

/** Human-readable summary first (helps the model), then the machine block. */
export function serializeFeedback(fb: ReviewFeedback): string {
  const name = (r: string) => (fb.labels?.[r] ? `${r} (${fb.labels[r]})` : r);
  const parts: string[] = [];
  if (fb.confirm.length)
    parts.push(
      `Confirmed ${fb.confirm.map(name).join(", ")}. These are verified sightings.`,
    );
  else parts.push("No sightings confirmed.");
  if (fb.reject.length)
    parts.push(
      `Rejected as false positives: ${fb.reject.map(name).join(", ")}.`,
    );
  return [
    parts.join(" "),
    "",
    block("vsg-feedback", {
      vss_query_id: fb.queryId,
      confirm: fb.confirm,
      reject: fb.reject,
    }),
  ].join("\n");
}
