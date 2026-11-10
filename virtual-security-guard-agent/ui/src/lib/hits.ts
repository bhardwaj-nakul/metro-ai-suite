// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { FrameLocator, VssHit } from "@/adapters/vss/types";
import { clipPathForVideo, framePath } from "@/lib/urls";

/** One VSS segment, independent of which query ranked it. Also a hit ref. */
export const segmentKey = (h: Pick<VssHit, "videoId" | "startS">) =>
  `${h.videoId}@${Math.round(h.startS)}`;

/**
 * Identity of one sighting, for de-duplication everywhere: a live frame by
 * camera and wall-clock time, a recorded hit by its segment.
 */
export const hitKey = (h: VssHit) =>
  h.source === "live"
    ? `${h.streamId ?? h.videoId}@${h.observedAt ?? h.seekS}`
    : segmentKey(h);

/** First tag of a VSS tag list (an array or a comma-separated string). */
export function firstTag(v: unknown): string | undefined {
  const t = Array.isArray(v) ? v[0] : v;
  if (typeof t !== "string") return undefined;
  return t.split(",")[0]?.trim() || undefined;
}

/**
 * Camera and media fields every VSS hit derives the same way, whether it came
 * from the MCP tool result or a stored query: a live hit's camera falls back
 * to its stream, a recorded hit's clip to the video's datastore path, and any
 * located frame becomes the poster.
 */
export function hitMedia(p: {
  live: boolean;
  videoId: string;
  streamId?: string;
  tag?: string;
  playbackUrl?: string;
  frame?: FrameLocator;
}): Pick<
  VssHit,
  "cameraTag" | "source" | "streamId" | "playbackUrl" | "frame" | "posterUrl"
> {
  const streamId = p.live ? (p.streamId ?? p.videoId) : undefined;
  return {
    cameraTag: p.tag ?? streamId,
    source: p.live ? "live" : "video",
    streamId,
    playbackUrl:
      p.playbackUrl ?? (p.live ? undefined : clipPathForVideo(p.videoId)),
    frame: p.frame,
    posterUrl: p.frame && framePath(p.frame),
  };
}

/** How the UI names a hit's camera. */
export const hitCameraLabel = (h: VssHit) =>
  h.cameraTag ?? h.videoName ?? "Unknown camera";

/**
 * Does an agent-supplied reference point at this hit? Small models do not
 * always copy `m<rank>` refs faithfully, so a video id or a segment key
 * (`<video_id>@<start_s>`) is accepted too.
 */
export function hitMatchesRef(h: VssHit, ref: string): boolean {
  const r = ref.trim().toLowerCase();
  if (!r) return false;
  return (
    r === h.matchId.toLowerCase() ||
    r === h.videoId.toLowerCase() ||
    r === segmentKey(h).toLowerCase()
  );
}

/**
 * Resolve agent refs to match ids. Returns undefined when there were no refs
 * or none of them matched, so callers fall back to "all hits" instead of
 * hiding everything behind a hallucinated id.
 */
export function resolveRefs(
  refs: readonly string[] | undefined,
  hits: readonly VssHit[],
): Set<string> | undefined {
  if (!refs?.length) return undefined;
  const out = new Set<string>();
  for (const h of hits)
    if (refs.some((r) => hitMatchesRef(h, r))) out.add(h.matchId);
  return out.size ? out : undefined;
}

/**
 * Lowest score a hit needs to count: the operator's minimum score (Settings)
 * as a fraction of the peak score among `hits`, so the cut-off holds whether
 * or not VSS normalised the result set.
 */
export function scoreCutoff(hits: readonly VssHit[], minScore: number): number {
  const peak = hits.reduce((m, h) => Math.max(m, h.score), 0);
  return peak * minScore;
}

/** Per-hit note from a `notes` map keyed by any accepted ref form. */
export function noteForHit(
  notes: Record<string, string> | undefined,
  h: VssHit,
): string | undefined {
  if (!notes) return undefined;
  for (const [ref, note] of Object.entries(notes))
    if (hitMatchesRef(h, ref)) return note;
  return undefined;
}
