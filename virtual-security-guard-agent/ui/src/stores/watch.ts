// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { toast } from "sonner";
import { create } from "zustand";
import { getAdapters } from "@/adapters";
import { VssError } from "@/adapters/vss/types";
import { scoreCutoff } from "@/lib/hits";
import { useLiveTimelineStore } from "./liveTimeline";
import { useSettingsStore } from "./settings";

/**
 * Live camera search runtime: a watched VSS search follows the subject on the
 * live cameras. A watch only starts from the operator's "Start live camera
 * search" button; Argus never starts one. The UI polls the stored query over
 * REST, so new sightings cost no LLM tokens, and folds its hits into the
 * session's live timeline (liveTimeline.ts), where the operator confirms them.
 */

export type WatchStatus =
  "starting" | "watching" | "stopped" | "expired" | "idle-stopped" | "error";

export interface WatchSubject {
  query?: string;
  imageUrl?: string;
  previewUrl?: string;
}

interface WatchState {
  queryId?: string;
  /** Hermes session whose live timeline the sightings go to. */
  sessionId?: string;
  subject?: WatchSubject;
  status?: WatchStatus;
  startedAt?: number;
  /** Browser time the watch stops (the watch duration setting). */
  deadline?: number;
  lastSightingAt?: number;
  error?: string;
  /** VSS refused to unwatch `queryId`; the query may still be running there. */
  stopFailed?: boolean;

  start: (subject: WatchSubject, sessionId: string) => Promise<void>;
  stop: (status?: WatchStatus) => Promise<void>;
  clear: () => void;
}

export const STOP_FAILED = "Couldn't stop the live search on VSS";

/** Live matches refresh every 10 seconds. */
const POLL_MS = 10_000;
/** Failed checks in a row before the live search is reported as failed. */
export const MAX_POLL_FAILURES = 3;
/**
 * The watched query id, per tab: a reload finds a watch the page left
 * running and unwatches it (the pagehide request is best-effort).
 */
const PENDING_KEY = "vsg.watch.pending";

let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let failures = 0;

/** Forget the pending query id, unless a newer watch replaced it. */
function forget(queryId: string) {
  if (sessionStorage.getItem(PENDING_KEY) === queryId)
    sessionStorage.removeItem(PENDING_KEY);
}

function stopTimer() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  generation++;
}

/**
 * Unwatch a query the store no longer tracks (a cleared watch, or one that
 * finished starting after Stop). A failure is surfaced with a retry.
 */
function unwatchDetached(queryId: string) {
  getAdapters()
    .vss.setWatch(queryId, false)
    .catch((e: Error) => stopFailedToast(queryId, e));
}

function stopFailedToast(queryId: string, e: Error) {
  toast.error(STOP_FAILED, {
    description: e.message,
    action: { label: "Retry", onClick: () => unwatchDetached(queryId) },
  });
}

export const useWatchStore = create<WatchState>()((set, get) => {
  async function poll(gen: number, intervalMs: number) {
    if (gen !== generation) return;
    const {
      queryId,
      sessionId,
      deadline,
      lastSightingAt,
      startedAt = Date.now(),
    } = get();
    if (!queryId || !sessionId) return;
    const idleMs = useSettingsStore.getState().watchIdleMinutes * 60_000;
    if (deadline && Date.now() >= deadline) return void get().stop("expired");
    if (Date.now() - (lastSightingAt ?? startedAt) >= idleMs)
      return void get().stop("idle-stopped");
    try {
      const q = await getAdapters().vss.getQuery(queryId);
      if (gen !== generation) return;
      if (q.status === "error") {
        await get().stop("error");
        if (!get().stopFailed)
          set({
            error: q.errorMessage ?? "VSS reported the live search failed.",
          });
        return;
      }
      const cutoff = scoreCutoff(
        q.hits,
        useSettingsStore.getState().minTraceScore,
      );
      const hits = q.hits.filter((h) => h.score >= cutoff);
      // VSS and browser clocks may differ: idle time is measured in browser time.
      if (useLiveTimelineStore.getState().addHits(sessionId, queryId, hits))
        set({ lastSightingAt: Date.now() });
      failures = 0;
      set({ error: undefined });
      if (get().status === "starting") set({ status: "watching" });
    } catch (e) {
      if (gen !== generation) return;
      const err = e as Error;
      if (err instanceof VssError && err.status === 404) {
        // The query is gone on VSS: nothing to unwatch, retrying can't help.
        stopTimer();
        forget(queryId);
        return void set({
          status: "error",
          error: `VSS no longer has this live search (${err.message})`,
        });
      }
      if (++failures >= MAX_POLL_FAILURES) {
        await get().stop("error");
        if (!get().stopFailed)
          set({
            error: `${failures} checks in a row failed: ${err.message}`,
          });
        return;
      }
      set({ error: err.message });
    }
    timer = setTimeout(() => void poll(gen, intervalMs), intervalMs);
  }

  function beginPolling() {
    stopTimer();
    failures = 0;
    const gen = generation;
    void poll(gen, POLL_MS);
  }

  return {
    async start(subject, sessionId) {
      if (get().status === "starting" || get().status === "watching") return;
      stopTimer();
      // Stop or clear while VSS creates the query bumps the generation.
      const gen = generation;
      const minutes = useSettingsStore.getState().watchMinutes;
      const now = Date.now();
      set({
        queryId: undefined,
        sessionId,
        subject,
        status: "starting",
        startedAt: now,
        deadline: now + minutes * 60_000,
        lastSightingAt: undefined,
        error: undefined,
        stopFailed: undefined,
      });
      let queryId: string;
      try {
        queryId = await getAdapters().vss.startWatch({
          query: subject.imageUrl ? undefined : subject.query,
          imageUrl: subject.imageUrl,
          windowMinutes: 5,
        });
      } catch (e) {
        if (gen === generation)
          set({ status: "error", error: (e as Error).message });
        return;
      }
      if (gen !== generation) return unwatchDetached(queryId);
      sessionStorage.setItem(PENDING_KEY, queryId);
      set({ queryId });
      beginPolling();
    },

    async stop(status = "stopped") {
      stopTimer();
      const gen = generation;
      const { queryId } = get();
      set({ status, stopFailed: undefined });
      if (!queryId) return;
      try {
        await getAdapters().vss.setWatch(queryId, false);
        forget(queryId);
      } catch (e) {
        // Cleared or restarted meanwhile: the store no longer shows this watch.
        if (gen !== generation) return stopFailedToast(queryId, e as Error);
        set({
          status: "error",
          stopFailed: true,
          error: `${STOP_FAILED}: ${(e as Error).message}`,
        });
      }
    },

    clear() {
      const { queryId, status, stopFailed } = get();
      stopTimer();
      // Also while starting: VSS already has the query once queryId is set.
      if (queryId && (isWatchActive({ status }) || stopFailed)) {
        forget(queryId);
        unwatchDetached(queryId);
      }
      set({
        queryId: undefined,
        subject: undefined,
        status: undefined,
        error: undefined,
        stopFailed: undefined,
      });
    },
  };
});

export function isWatchActive(s: { status?: WatchStatus }) {
  return s.status === "starting" || s.status === "watching";
}

// A watch the last page load left running in this tab (reload, crash).
const leftOver = sessionStorage.getItem(PENDING_KEY);
if (leftOver) {
  sessionStorage.removeItem(PENDING_KEY);
  unwatchDetached(leftOver);
}

// Closing or reloading the tab stops the watch on VSS.
window.addEventListener("pagehide", () => {
  const { queryId, status, stopFailed } = useWatchStore.getState();
  if (queryId && (isWatchActive({ status }) || stopFailed))
    getAdapters().vss.unwatchOnUnload(queryId);
});
// Back from the back/forward cache: the watch was unwatched on pagehide.
window.addEventListener("pageshow", (e) => {
  if (e.persisted && isWatchActive(useWatchStore.getState()))
    void useWatchStore.getState().stop();
});
