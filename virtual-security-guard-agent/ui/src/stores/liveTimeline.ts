// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { VssHit } from "@/adapters/vss/types";
import { hitCameraLabel, hitKey } from "@/lib/hits";
import { persistStorage } from "@/lib/storage";
import { hitTime } from "@/lib/time";

/**
 * Live search timeline. A watched VSS query only ranks the last few minutes of
 * live footage and keeps no history, so the UI keeps it: live hits from one
 * camera fold into one sighting with a start and end time. Saved per Hermes
 * session in this browser; confirmed sightings join the route.
 */

/** Hits on the same camera at most this far apart are one sighting. */
export const SIGHTING_GAP_MS = 60_000;
/** Investigations whose timeline is kept in this browser. */
const MAX_SESSIONS = 20;
/** Sightings kept per investigation; the oldest unconfirmed go first. */
const MAX_SIGHTINGS = 200;

export interface LiveSighting {
  /**
   * Watch plus the key of the first hit; stable for the sighting's lifetime
   * and unique even when Search again re-ranks the same footage.
   */
  id: string;
  camera: string;
  /** Wall-clock time of the first and latest detection (ISO-8601, VSS clock). */
  start: string;
  end: string;
  /** Highest-scoring detection: the thumbnail and clip. */
  best: VssHit;
  count: number;
  confirmed: boolean;
  /** Watched query that found it; grouping never spans two watches. */
  watch: string;
}

/**
 * Fold one poll's live hits into the timeline. Per camera, a hit no later
 * than the camera's latest detection in this watch was already counted (the
 * watched query returns its whole window on every poll). Returns the same
 * array when nothing changed.
 */
export function addHits(
  sightings: readonly LiveSighting[],
  watch: string,
  hits: readonly VssHit[],
): readonly LiveSighting[] {
  const fresh = hits
    .filter((h) => h.source === "live" && hitTime(h))
    .map((h) => ({ h, t: hitTime(h)!.getTime() }))
    .sort((a, b) => a.t - b.t);
  if (!fresh.length) return sightings;
  const out = sightings.slice();
  let changed = false;
  for (const { h, t } of fresh) {
    const camera = hitCameraLabel(h);
    let i = out.length - 1;
    while (i >= 0 && !(out[i].watch === watch && out[i].camera === camera)) i--;
    const last = out[i];
    if (last && t <= Date.parse(last.end)) continue;
    changed = true;
    const at = new Date(t).toISOString();
    if (last && t - Date.parse(last.end) <= SIGHTING_GAP_MS)
      out[i] = {
        ...last,
        end: at,
        count: last.count + 1,
        best: h.score > last.best.score ? h : last.best,
      };
    else
      out.push({
        id: `${watch}:${hitKey(h)}`,
        camera,
        start: at,
        end: at,
        best: h,
        count: 1,
        confirmed: false,
        watch,
      });
  }
  return changed ? out : sightings;
}

/**
 * Keep at most `max` sightings, dropping the oldest unconfirmed ones; a
 * confirmed sighting is on the route and is never dropped. Returns the same
 * array when it fits.
 */
export function capSightings(
  sightings: readonly LiveSighting[],
  max = MAX_SIGHTINGS,
): readonly LiveSighting[] {
  let excess = sightings.length - max;
  if (excess <= 0) return sightings;
  return sightings.filter((s) => s.confirmed || excess-- <= 0);
}

/** Live hits VSS sent without a usable time: they can't be placed. */
export const untimedLiveHits = (hits: readonly VssHit[]) =>
  hits.filter((h) => h.source === "live" && !hitTime(h)).length;

/** A confirmed sighting as a route hit: its best frame, placed at its start. */
export const sightingHit = (s: LiveSighting): VssHit => ({
  ...s.best,
  observedAt: s.start,
});

const NONE: readonly LiveSighting[] = [];

const sightingSchema = z.looseObject({
  id: z.string(),
  camera: z.string(),
  start: z.string(),
  end: z.string(),
  best: z.looseObject({
    matchId: z.string(),
    videoId: z.string(),
    score: z.number(),
    seekS: z.number(),
  }),
  count: z.number(),
  confirmed: z.boolean(),
  watch: z.string(),
});

/**
 * Stored timelines that still have the expected shape. Storage is shared with
 * other tabs and older builds, so anything else is dropped, not trusted.
 */
export function restoreBySession(
  stored: unknown,
): Record<string, readonly LiveSighting[]> {
  const by = z
    .object({ bySession: z.record(z.string(), z.unknown()) })
    .safeParse(stored);
  if (!by.success) return {};
  const out: Record<string, readonly LiveSighting[]> = {};
  let dropped = 0;
  for (const [id, list] of Object.entries(by.data.bySession)) {
    if (!Array.isArray(list)) {
      dropped++;
      continue;
    }
    const ok = list.filter((x) => sightingSchema.safeParse(x).success);
    dropped += list.length - ok.length;
    out[id] = ok as LiveSighting[];
  }
  if (dropped)
    console.warn(`Live timeline: dropped ${dropped} unreadable stored entries`);
  return out;
}

/** Watches already warned about hits without a time (one warning each). */
const warnedUntimed = new Set<string>();

interface LiveTimelineState {
  bySession: Record<string, readonly LiveSighting[]>;
  /** Returns true when the poll added or extended a sighting. */
  addHits: (
    sessionId: string,
    watch: string,
    hits: readonly VssHit[],
  ) => boolean;
  toggleConfirmed: (sessionId: string, id: string) => void;
}

/** Store `list` for `sessionId` as the most recent session, dropping the oldest. */
function put(
  bySession: Record<string, readonly LiveSighting[]>,
  sessionId: string,
  list: readonly LiveSighting[],
) {
  const rest = Object.entries(bySession).filter(([k]) => k !== sessionId);
  return Object.fromEntries([
    ...rest.slice(-(MAX_SESSIONS - 1)),
    [sessionId, list],
  ]);
}

export const useLiveTimelineStore = create<LiveTimelineState>()(
  persist(
    (set, get) => ({
      bySession: {},
      addHits(sessionId, watch, hits) {
        const untimed = untimedLiveHits(hits);
        if (untimed && !warnedUntimed.has(watch)) {
          warnedUntimed.add(watch);
          console.warn(
            `Live search ${watch}: ${untimed} live hit(s) without a usable time were skipped`,
          );
        }
        const before = get().bySession[sessionId] ?? NONE;
        const after = addHits(before, watch, hits);
        if (after === before) return false;
        set({
          bySession: put(get().bySession, sessionId, capSightings(after)),
        });
        return true;
      },
      toggleConfirmed(sessionId, id) {
        const list = get().bySession[sessionId] ?? NONE;
        set({
          bySession: put(
            get().bySession,
            sessionId,
            list.map((s) =>
              s.id === id ? { ...s, confirmed: !s.confirmed } : s,
            ),
          ),
        });
      },
    }),
    {
      name: "vsg.live-timeline.v1",
      storage: persistStorage(),
      partialize: ({ bySession }) => ({ bySession }),
      merge: (stored, current) => ({
        ...current,
        bySession: restoreBySession(stored),
      }),
    },
  ),
);

// Another tab saved its timelines: load them, so this tab's next save keeps them.
window.addEventListener("storage", (e) => {
  if (e.key === useLiveTimelineStore.persist.getOptions().name)
    void useLiveTimelineStore.persist.rehydrate();
});

/** The session's live sightings (a stable reference). */
export const sessionSightings = (
  s: Pick<LiveTimelineState, "bySession">,
  sessionId: string | undefined,
) => (sessionId && s.bySession[sessionId]) || NONE;
