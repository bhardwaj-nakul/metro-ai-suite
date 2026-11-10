// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import {
  FIXTURE_TAGS,
  MOCK_QUERIES,
  MOCK_STREAMS,
  mockFrame,
} from "@/fixtures/vss";
import {
  VssError,
  type VssAdapter,
  type VssHit,
  type VssStoredQuery,
  type VssStream,
} from "./types";

/**
 * Offline VSS with the Level 4 camera set, scripted stored queries, in-memory
 * live cameras and a watch that produces a sighting now and then.
 */
export function createMockVss(): VssAdapter {
  let streams: VssStream[] = MOCK_STREAMS.map((s) => ({ ...s }));
  const watches = new Map<string, VssStoredQuery>();
  let n = 0;

  function tickWatch(q: VssStoredQuery) {
    const live = streams.filter((s) => s.state === "running");
    if (!live.length || Math.random() < 0.5) return;
    const s = live[Math.floor(Math.random() * live.length)];
    const rank = q.hits.length + 1;
    const hit: VssHit = {
      matchId: `m${rank}`,
      rank,
      videoId: s.streamId,
      cameraTag: s.tags[0] ?? s.streamId,
      streamId: s.streamId,
      source: "live",
      observedAt: new Date().toISOString(),
      startS: 4,
      endS: 4,
      seekS: 4,
      score: 0.6 + Math.random() * 0.4,
      posterUrl: mockFrame(`live:${s.streamId}:${rank}`),
    };
    q.hits = [hit, ...q.hits].slice(0, 40);
  }

  return {
    async health() {
      return true;
    },
    async features() {
      return { search: true, summary: false, imageSearch: true };
    },
    async listTags() {
      return [...FIXTURE_TAGS];
    },
    async getQuery(queryId) {
      const w = watches.get(queryId);
      if (w) {
        tickWatch(w);
        return structuredClone(w);
      }
      const q = MOCK_QUERIES[queryId];
      if (!q) throw new VssError(`Query ${queryId} not found`, 404);
      return structuredClone(q);
    },
    async uploadImage(file, filename = "query.jpg") {
      const id = `${Date.now().toString(36)}-${filename}`;
      const previewUrl =
        typeof URL.createObjectURL === "function"
          ? URL.createObjectURL(file)
          : mockFrame(id);
      return {
        imageId: id,
        imageUrl: `/datastore/video-summary/search-images/${id}`,
        previewUrl,
      };
    },
    async listStreams() {
      return streams.map((s) => ({
        ...s,
        lastFrameAt: s.state === "running" ? Date.now() - 1500 : s.lastFrameAt,
      }));
    },
    async addStream(input) {
      if (!/^rtsps?:\/\//i.test(input.streamUrl))
        throw new VssError(
          "stream_url must start with rtsp:// or rtsps://",
          400,
        );
      const id = `live${Date.now().toString(16)}`;
      streams = [
        {
          streamId: id,
          name: input.name || input.streamUrl,
          url: input.streamUrl,
          state: input.start === false ? "paused" : "running",
          description: input.description,
          tags: input.tags ?? [],
          frameInterval: input.frameInterval ?? 15,
          objectDetection: input.objectDetection ?? true,
          createdAt: Date.now(),
        },
        ...streams,
      ];
    },
    async updateStream(id, patch) {
      const s = streams.find((x) => x.streamId === id);
      if (!s) throw new VssError("Stream not found", 404);
      Object.assign(s, {
        ...(patch.state && { state: patch.state }),
        ...(patch.frameInterval && { frameInterval: patch.frameInterval }),
        ...(patch.objectDetection !== undefined && {
          objectDetection: patch.objectDetection,
        }),
      });
    },
    async removeStream(id) {
      streams = streams.filter((s) => s.streamId !== id);
    },
    async startWatch(req) {
      const queryId = `mock-watch-${++n}`;
      watches.set(queryId, {
        queryId,
        query: req.query ?? "",
        image: req.imageUrl,
        status: "idle",
        tags: [],
        hits: [],
      });
      return queryId;
    },
    async setWatch(queryId, watch) {
      if (!watch) watches.delete(queryId);
    },
    unwatchOnUnload(queryId) {
      watches.delete(queryId);
    },
  };
}
