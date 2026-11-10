// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Client-side frame grabs for sightings. VSS returns no thumbnails, so we load
 * the (same-origin) clip in a hidden <video>, seek to the best frame and draw
 * it to a canvas. Two grabs run at a time; results live in a small LRU of blob
 * URLs.
 */

const MAX_CONCURRENT = 2;
const MAX_CACHED = 160;
const GRAB_TIMEOUT_MS = 15_000;
const THUMB_WIDTH = 428;

const cache = new Map<string, Promise<string>>();
const queue: (() => void)[] = [];
let active = 0;

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    active++;
    queue.shift()!();
  }
}

function schedule<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push(() => {
      job()
        .then(resolve, reject)
        .finally(() => {
          active--;
          pump();
        });
    });
    pump();
  });
}

function remember(key: string, p: Promise<string>) {
  cache.set(key, p);
  while (cache.size > MAX_CACHED) {
    const [oldKey, old] = cache.entries().next().value as [
      string,
      Promise<string>,
    ];
    cache.delete(oldKey);
    old
      .then((u) => u.startsWith("blob:") && URL.revokeObjectURL(u))
      .catch(() => undefined);
  }
}

/** Draw the frame at `seekS` to a canvas. Resolves with the canvas. */
export function grabFrameCanvas(
  url: string,
  seekS: number,
  width = THUMB_WIDTH,
): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      video.removeAttribute("src");
      video.load();
    };
    const timer = setTimeout(
      () => done(() => reject(new Error("Timed out loading clip"))),
      GRAB_TIMEOUT_MS,
    );
    video.addEventListener("error", () =>
      done(() => reject(new Error("Clip could not be loaded"))),
    );
    video.addEventListener("loadedmetadata", () => {
      const t = Math.min(
        Math.max(0, seekS),
        Math.max(0, (video.duration || seekS) - 0.05),
      );
      video.currentTime = t;
    });
    video.addEventListener("seeked", () =>
      done(() => {
        const w = Math.min(width, video.videoWidth || width);
        const h = Math.round(
          (w / (video.videoWidth || 16)) * (video.videoHeight || 9),
        );
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unavailable"));
        ctx.drawImage(video, 0, 0, w, h);
        resolve(canvas);
      }),
    );
    video.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/jpeg",
  q = 0.82,
) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Encode failed"))),
      type,
      q,
    ),
  );
}

/** Cached thumbnail (blob URL) for a clip position. */
export function getThumbnail(url: string, seekS: number): Promise<string> {
  const key = `${url}@${seekS.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const p = schedule(async () => {
    const canvas = await grabFrameCanvas(url, seekS);
    return URL.createObjectURL(await canvasToBlob(canvas));
  });
  remember(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

/** Read any image URL (blob:, data:, same-origin) into a data URL for the PDF. */
export async function toDataUrl(src: string): Promise<string> {
  if (src.startsWith("data:image/") && !src.startsWith("data:image/svg"))
    return src;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || 856;
  canvas.height = img.naturalHeight || 480;
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}
