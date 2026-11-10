// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { z } from "zod";

/**
 * Body of a gateway response: parsed JSON, `undefined` when empty, or the raw
 * text when it is not JSON (only meaningful for error statuses).
 */
export async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * A successful response must be JSON. An HTML body usually means the gateway
 * or dev proxy served the app shell instead of forwarding the request.
 */
export function unexpectedBody(service: string, body: string): string {
  const kind = body.trimStart().startsWith("<") ? "got HTML" : "not JSON";
  return `Unexpected response from ${service} (${kind}, check the gateway/proxy)`;
}

/** Validate a response envelope; `fail` builds the adapter's error type. */
export function parseEnvelope<S extends z.ZodType>(
  schema: S,
  body: unknown,
  what: string,
  fail: (message: string) => Error,
): z.infer<S> {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const at = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
  throw fail(`Unexpected ${what}${at}: ${issue?.message ?? "invalid"}`);
}
