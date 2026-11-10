// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useEffect } from "react";
import { create } from "zustand";
import { getAdapters } from "@/adapters";
import type { StreamInput, StreamPatch, VssStream } from "@/adapters/vss/types";

export type CameraStatus = "live" | "starting" | "paused" | "offline";

/** A live camera as the console shows it: one VSS RTSP stream. */
export interface Camera extends VssStream {
  /** Same as streamId. */
  id: string;
  /** The stream's VSS description; show `useCameraLocation`, which prefers the plan zone. */
  location: string;
  /** Key used by hits (`cameraTag`) and the floorplan: the stream's VSS tag, else its id. */
  tag: string;
  status: CameraStatus;
  /** Host (and port) parsed from the RTSP URL. */
  ip?: string;
}

/** How often pages that show camera status re-read the streams. */
export const CAMERA_POLL_MS = 10_000;

/** A running camera is offline once its frame clock stops advancing this long. */
const STALE_MS = 60_000;

/**
 * Last-frame value per stream and when (browser clock) it last changed. VSS
 * and browser clocks can differ, so staleness is measured by whether VSS's
 * last_frame_ts advances between refreshes, never by comparing the two clocks.
 */
const frameSeen = new Map<string, { frame: number; changedAt: number }>();

export function cameraStatus(s: VssStream, now = Date.now()): CameraStatus {
  const state = s.state.toLowerCase();
  if (state === "paused" || state === "stopped") return "paused";
  if (state === "error" || state === "failed") return "offline";
  if (state !== "running") return "starting";
  if (!s.lastFrameAt) return "starting";
  const prev = frameSeen.get(s.streamId);
  if (!prev || prev.frame !== s.lastFrameAt) {
    frameSeen.set(s.streamId, { frame: s.lastFrameAt, changedAt: now });
    return "live";
  }
  return now - prev.changedAt > STALE_MS ? "offline" : "live";
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url.replace(/^rtsps?:/i, "http:")).host || undefined;
  } catch {
    return undefined;
  }
}

export function toCamera(s: VssStream): Camera {
  return {
    ...s,
    id: s.streamId,
    location: s.description ?? "",
    tag: s.tags[0] ?? s.streamId,
    status: cameraStatus(s),
    ip: hostOf(s.url),
  };
}

export interface CamerasState {
  cameras: Camera[];
  loaded: boolean;
  error?: string;
  /** Re-read GET /manager/streams. */
  load: () => Promise<void>;
  add: (input: StreamInput) => Promise<void>;
  update: (streamId: string, patch: StreamPatch) => Promise<void>;
  remove: (streamId: string) => Promise<void>;
}

/**
 * Bumped after every change sent to VSS. A list read that started before a
 * change may predate it (a removed camera would come back), so it is dropped.
 */
let changes = 0;

/** Live camera fleet, read from VSS; every change goes straight to VSS. */
export const useCamerasStore = create<CamerasState>()((set, get) => ({
  cameras: [],
  loaded: false,

  async load() {
    const startedAt = changes;
    try {
      const streams = await getAdapters().vss.listStreams();
      if (startedAt !== changes) return;
      const cameras = streams.map(toCamera);
      set({ cameras, loaded: true, error: undefined });
    } catch (e) {
      if (startedAt !== changes) return;
      set({ loaded: true, error: (e as Error).message });
    }
  },

  async add(input) {
    await getAdapters().vss.addStream(input);
    changes++;
    await get().load();
  },

  async update(streamId, patch) {
    await getAdapters().vss.updateStream(streamId, patch);
    changes++;
    await get().load();
  },

  async remove(streamId) {
    await getAdapters().vss.removeStream(streamId);
    changes++;
    set({ cameras: get().cameras.filter((c) => c.streamId !== streamId) });
  },
}));

/** Is any live camera connected and sending frames? */
export const selectHasLiveCamera = (s: CamerasState) =>
  s.cameras.some((c) => c.status === "live");

export const selectLiveCameraCount = (s: CamerasState) =>
  s.cameras.filter((c) => c.status === "live").length;

/**
 * Camera for a hit's key: its VSS tag, or the stream id of a hit that carried
 * no tag. Streams sharing a tag are one camera; a live one wins.
 */
function findCamera(cameras: Camera[], tag: string): Camera | undefined {
  const same = cameras.filter((c) => c.tag === tag || c.streamId === tag);
  return same.find((c) => c.status === "live") ?? same[0];
}

export function selectCameraByTag(tag: string | undefined) {
  return (s: CamerasState) => (tag ? findCamera(s.cameras, tag) : undefined);
}

/** Keep the camera list fresh while a page shows it (only when visible). */
export function useCameraPolling() {
  const load = useCamerasStore((s) => s.load);
  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, CAMERA_POLL_MS);
    return () => clearInterval(t);
  }, [load]);
}
