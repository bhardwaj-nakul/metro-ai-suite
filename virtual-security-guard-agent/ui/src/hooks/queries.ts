// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getAdapters } from "@/adapters";
import type { HermesAdapter, HermesSession } from "@/adapters/hermes/types";
import { env } from "@/config/env";
import { useCamerasStore } from "@/stores/cameras";
import { useInvestigationStore } from "@/stores/investigation";

export const qk = {
  health: ["health"] as const,
  tags: ["vss", "tags"] as const,
  streams: ["vss", "streams"] as const,
  sessions: (rev: number) => ["hermes", "sessions", rev] as const,
  messages: (id: string) => ["hermes", "messages", id] as const,
};

export function useHealth() {
  return useQuery({
    queryKey: qk.health,
    queryFn: async () => {
      const { hermes, vss } = getAdapters();
      const [h, v] = await Promise.all([hermes.health(), vss.health()]);
      return { hermes: h, vss: v };
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useTags() {
  return useQuery({
    queryKey: qk.tags,
    queryFn: () => getAdapters().vss.listTags(),
    staleTime: 5 * 60_000,
  });
}

/**
 * Every VSS camera tag: VSS's tag list plus the live streams' tags (a new
 * stream shows before the tag list refreshes). Undefined until VSS answers.
 */
export function useKnownTags(): string[] | undefined {
  const cameras = useCamerasStore((s) => s.cameras);
  const { data: vssTags } = useTags();
  return useMemo(
    () =>
      vssTags
        ? [...new Set([...cameras.map((c) => c.tag), ...vssTags])]
        : undefined,
    [cameras, vssTags],
  );
}

/** Investigations per page (History and Reports load older ones on demand). */
const INVESTIGATION_PAGE = 10;
/** Hermes sessions read per request while looking for investigations. */
const SESSION_BATCH = 50;

/**
 * One page of past investigations (Hermes sessions with the VSG title prefix),
 * read from Hermes `offset`. Hermes can't filter by prefix, so sessions are
 * read in batches until `size` are found; `next` is the offset to go on from.
 */
export async function investigationPage(
  list: HermesAdapter["listSessions"],
  offset: number,
  size = INVESTIGATION_PAGE,
): Promise<{ found: HermesSession[]; next?: number }> {
  const found: HermesSession[] = [];
  for (;;) {
    const { sessions, hasMore } = await list({ limit: SESSION_BATCH, offset });
    for (const [i, s] of sessions.entries()) {
      if (!s.title.startsWith(env.sessionPrefix)) continue;
      found.push({ ...s, title: s.title.slice(env.sessionPrefix.length) });
      if (found.length === size) {
        const more = i + 1 < sessions.length || hasMore;
        return { found, next: more ? offset + i + 1 : undefined };
      }
    }
    if (!hasMore || !sessions.length) return { found };
    offset += sessions.length;
  }
}

/** Past investigations, most recent first, `INVESTIGATION_PAGE` at a time. */
export function useInvestigations() {
  const revision = useInvestigationStore((s) => s.revision);
  const query = useInfiniteQuery({
    queryKey: qk.sessions(revision),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      investigationPage(getAdapters().hermes.listSessions, pageParam),
    getNextPageParam: (last) => last.next,
    staleTime: 10_000,
  });
  // A session that moved up while paging can show up twice: keep the first.
  const data = useMemo(() => {
    if (!query.data) return undefined;
    const seen = new Map<string, HermesSession>();
    for (const p of query.data.pages)
      for (const s of p.found) if (!seen.has(s.id)) seen.set(s.id, s);
    return [...seen.values()];
  }, [query.data]);
  return { ...query, data };
}
