// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { env } from "@/config/env";

const DEFAULT_BUCKET = "video-summary";
const LIVE_BUCKET = "live-streams";

/**
 * Normalise any VSS media reference to a same-origin datastore path the
 * browser can load through the proxy. Accepts:
 *  - absolute gateway URLs   http://host:12345/datastore/video-summary/<id>/source.mp4
 *  - gateway paths           /datastore/video-summary/<id>/source.mp4
 *  - videoPlaybackUrl         /video-summary/<id>/source.mp4
 *  - VideoEntity.url          <id>/source.mp4
 * Returns undefined for anything that is not a datastore object (e.g. internal
 * dataprep download URLs), so callers never point the browser at a foreign host.
 */
export function toDatastorePath(
  ref: string | null | undefined,
  base: string = env.vssBase,
): string | undefined {
  if (!ref) return undefined;
  let path = ref.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return undefined;
    }
  }
  if (path.startsWith(`${base}/datastore/`)) return path;
  if (path.startsWith("/datastore/")) return `${base}${path}`;
  if (
    path.startsWith(`/${DEFAULT_BUCKET}/`) ||
    path.startsWith(`/${LIVE_BUCKET}/`)
  )
    return `${base}/datastore${path}`;
  if (/^[0-9a-f-]{8,}\/[^/]+$/i.test(path))
    return `${base}/datastore/${DEFAULT_BUCKET}/${path}`;
  return undefined;
}

/** Clip URL for a video id when only the id is known. */
export function clipPathForVideo(videoId: string, base: string = env.vssBase) {
  return `${base}/datastore/${DEFAULT_BUCKET}/${encodeURIComponent(videoId)}/source.mp4`;
}

/** Media-fragment URL so a <video> starts at the sighting. */
export function withTimeFragment(url: string, startS?: number, endS?: number) {
  if (startS === undefined || !Number.isFinite(startS)) return url;
  const s = Math.max(0, startS).toFixed(1);
  const e =
    endS !== undefined && Number.isFinite(endS) && endS > startS
      ? `,${endS.toFixed(1)}`
      : "";
  return `${url}#t=${s}${e}`;
}

export function managerPath(path: string, base: string = env.vssBase) {
  return `${base}/manager${path.startsWith("/") ? path : `/${path}`}`;
}

/** Same-origin JPEG of one stored frame (a live hit's detected crop). */
export function framePath(
  f: {
    videoId: string;
    timestamp: number;
    mediaPath?: string;
    bucketName?: string;
    cropBbox?: string;
  },
  opts: { crop?: boolean; quality?: number } = {},
  base: string = env.vssBase,
) {
  const q = new URLSearchParams({
    video_id: f.videoId,
    timestamp: String(f.timestamp),
    quality: String(opts.quality ?? 70),
  });
  if (f.mediaPath) q.set("media_path", f.mediaPath);
  if (f.bucketName) q.set("bucket_name", f.bucketName);
  if (f.cropBbox && opts.crop !== false) q.set("crop_bbox", f.cropBbox);
  return managerPath(`/frames?${q}`, base);
}

/** Replace credentials in any rtsp:// URL with ***. */
export function redactUrl(s: string | undefined): string | undefined {
  return s?.replace(/\b(rtsps?:\/\/)[^/@\s]+@/gi, "$1***@");
}
