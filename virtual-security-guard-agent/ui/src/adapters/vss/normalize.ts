// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { firstTag, hitMedia } from "@/lib/hits";
import { redactUrl, toDatastorePath } from "@/lib/urls";
import type { FrameLocator, VssHit, VssStoredQuery, VssStream } from "./types";

type Json = Record<string, unknown>;

const num = (v: unknown, d = 0): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;
const obj = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};

/** A live segment object is named after the epoch second it started. */
const SEGMENT_EPOCH_RE = /(?:^|\/)(\d{9,11})(?:\.\d+)?\.mp4$/;

/** Wall-clock time of a live frame: segment epoch + offset into it. */
export function liveObservedAt(
  mediaPath: string | undefined,
  offsetS: number,
  fallbackIso?: string,
): string | undefined {
  const m = mediaPath ? SEGMENT_EPOCH_RE.exec(mediaPath) : null;
  let base = m ? Number(m[1]) * 1000 : NaN;
  if (Number.isNaN(base) && fallbackIso) base = Date.parse(fallbackIso);
  return Number.isNaN(base)
    ? undefined
    : new Date(base + offsetS * 1000).toISOString();
}

function frameFrom(best: Json, videoId: string): FrameLocator | undefined {
  const ts = num(best.timestamp, NaN);
  if (!videoId || !Number.isFinite(ts)) return undefined;
  return {
    videoId: str(best.video_id) ?? videoId,
    timestamp: ts,
    mediaPath: str(best.media_path),
    bucketName: str(best.bucket_name),
    cropBbox: str(best.crop_bbox),
  };
}

/** Normalise one entry of a stored query's `results[]`. */
export function normalizeHit(r: Json, index: number): VssHit {
  const m = obj(r.metadata);
  const video = obj(r.video);
  const vmeta = obj(m.video_metadata);
  const best = obj(m.best_frame_info);
  const rank = num(m.rank, index + 1);
  const videoId = str(m.video_id) ?? str(video.videoId) ?? "";
  const startS = num(m.segment_start, num(m.timestamp));
  const endS = num(m.segment_end, startS);
  const live = best.is_live === true;
  const frame = frameFrom(best, videoId);
  return {
    matchId: `m${rank}`,
    rank,
    videoId,
    videoName: str(video.name),
    ...hitMedia({
      live,
      videoId,
      // VSS stores one tag per hit, unique to its camera, live or recorded.
      tag: firstTag(m.tags) ?? firstTag(vmeta.tags) ?? firstTag(video.tags),
      playbackUrl:
        toDatastorePath(str(r.videoPlaybackUrl)) ??
        toDatastorePath(str(video.url)) ??
        (live ? toDatastorePath(str(m.video_url)) : undefined),
      frame,
    }),
    observedAt: live
      ? liveObservedAt(
          frame?.mediaPath,
          frame?.timestamp ?? 0,
          str(vmeta.created_at) ?? str(m.created_at),
        )
      : undefined,
    startS,
    endS,
    seekS: num(m.seek_timestamp, num(best.timestamp, startS)),
    score: num(m.relevance_score, num(m.score)),
    ingestedAt: str(m.created_at) ?? str(vmeta.created_at),
    fileName: str(obj(video.dataStore).fileName),
    durationS: num(vmeta.duration, NaN) || undefined,
    detection: Object.keys(best).length
      ? {
          label: str(best.detected_label),
          confidence:
            typeof best.detection_confidence === "number"
              ? best.detection_confidence
              : undefined,
          timestamp:
            typeof best.timestamp === "number" ? best.timestamp : undefined,
        }
      : undefined,
  };
}

function queryImage(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  if (s.startsWith("data:image/")) return s;
  return toDatastorePath(s);
}

const QUERY_STATUSES = ["idle", "running", "error"] as const;

/**
 * Normalise GET /manager/search/:queryId. Hits are kept in stored (rank)
 * order; a hit without a video id identifies no clip or camera and is dropped.
 */
export function normalizeStoredQuery(q: Json): VssStoredQuery {
  const results = Array.isArray(q.results) ? (q.results as Json[]) : [];
  const hits = results
    .map(normalizeHit)
    .filter((h) => h.videoId)
    .sort((a, b) => a.rank - b.rank);
  const tags = Array.isArray(q.tags)
    ? (q.tags as unknown[]).filter((t): t is string => typeof t === "string")
    : (str(q.tags)
        ?.split(",")
        .map((t) => t.trim())
        .filter(Boolean) ?? []);
  return {
    queryId: String(q.queryId ?? ""),
    query: String(q.query ?? ""),
    image: queryImage(q.image) ?? queryImage(q.imageUrl),
    status: QUERY_STATUSES.find((st) => st === q.queryStatus) ?? "unknown",
    tags,
    createdAt: str(q.createdAt),
    errorMessage: str(q.errorMessage),
    hits,
  };
}

/** Normalise one dataprep LiveStreamInfo (GET /manager/streams). */
export function normalizeStream(v: Json): VssStream {
  const stats = obj(v.stats);
  const epochMs = (x: unknown) => {
    const n = num(x, NaN);
    return Number.isFinite(n) && n > 0 ? n * 1000 : undefined;
  };
  const url = redactUrl(str(v.stream_url) ?? "") ?? "";
  const rawName = str(v.stream_name);
  return {
    streamId: String(v.stream_id ?? ""),
    // Pipeline Manager defaults the name to the URL (credentials included).
    name: rawName && rawName !== str(v.stream_url) ? rawName : url,
    url,
    state: String(v.state ?? "unknown"),
    description: str(v.description),
    tags: Array.isArray(v.tags)
      ? (v.tags as unknown[]).filter((t): t is string => typeof t === "string")
      : [],
    frameInterval: num(v.frame_interval, NaN) || undefined,
    objectDetection:
      typeof v.enable_object_detection === "boolean"
        ? v.enable_object_detection
        : undefined,
    detectionConfidence: num(v.detection_confidence, NaN) || undefined,
    framesProcessed: num(stats.frames_processed, NaN) || undefined,
    embeddingsCreated: num(stats.embeddings_created, NaN) || undefined,
    lastFrameAt: epochMs(stats.last_frame_ts),
    error: redactUrl(str(v.last_error)),
    createdAt: epochMs(v.created_ts),
  };
}
