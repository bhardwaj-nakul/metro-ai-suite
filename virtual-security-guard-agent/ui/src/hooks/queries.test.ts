// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { HermesAdapter, HermesSession } from "@/adapters/hermes/types";
import { env } from "@/config/env";
import { investigationPage } from "./queries";

/** Hermes sessions, most recent first: every third one is not a VSG session. */
const all: HermesSession[] = Array.from({ length: 130 }, (_, i) => ({
  id: `s${i}`,
  title: i % 3 === 2 ? `other ${i}` : `${env.sessionPrefix}case ${i}`,
}));
const list: HermesAdapter["listSessions"] = async ({
  limit = 50,
  offset = 0,
} = {}) => ({
  sessions: all.slice(offset, offset + limit),
  hasMore: offset + limit < all.length,
});
const vsgIds = all
  .filter((s) => s.title.startsWith(env.sessionPrefix))
  .map((s) => s.id);

describe("investigationPage", () => {
  it("pages through every investigation once, in order, across batches", async () => {
    const seen: string[] = [];
    let offset: number | undefined = 0;
    while (offset !== undefined) {
      const page: Awaited<ReturnType<typeof investigationPage>> =
        await investigationPage(list, offset, 10);
      expect(page.found.length).toBeLessThanOrEqual(10);
      seen.push(...page.found.map((s) => s.id));
      offset = page.next;
    }
    expect(seen).toEqual(vsgIds);
  });

  it("strips the VSG prefix from titles", async () => {
    const { found } = await investigationPage(list, 0, 1);
    expect(found[0].title).toBe("case 0");
  });

  it("has no next page when the page ends on the last session", async () => {
    // The last session (s129) is an investigation.
    const page = await investigationPage(list, 0, vsgIds.length);
    expect(page.found).toHaveLength(vsgIds.length);
    expect(page.next).toBeUndefined();
  });
});
