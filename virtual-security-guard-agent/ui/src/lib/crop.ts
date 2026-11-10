// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
/**
 * A rectangle in unit coordinates (0..1) of the source frame. Unit space is
 * scale-independent, so the same box maps to the display (percentage overlay)
 * and to the full-resolution canvas without any pixel bookkeeping.
 */
export interface UnitBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Normalise a drag rectangle into a box inside the unit square. Accepts
 * negative w/h (a drag towards the top-left) and clamps the whole box to the
 * unit square so the crop can never run off the frame. When nothing is
 * clamped the original size is kept exactly; when an edge is clamped the size
 * is recomputed from the clamped span.
 */
export function clampUnitBox(
  x: number,
  y: number,
  w: number,
  h: number,
): UnitBox {
  const left = Math.min(x, x + w);
  const right = Math.max(x, x + w);
  const top = Math.min(y, y + h);
  const bottom = Math.max(y, y + h);
  const cl = Math.max(0, Math.min(1, left));
  const ct = Math.max(0, Math.min(1, top));
  const cw =
    left >= 0 && right <= 1
      ? Math.abs(w)
      : Math.max(0, Math.min(1, right) - cl);
  const ch =
    top >= 0 && bottom <= 1
      ? Math.abs(h)
      : Math.max(0, Math.min(1, bottom) - ct);
  return { x: cl, y: ct, w: cw, h: ch };
}

/** Map a unit box to source pixels. */
export function unitToPx(
  box: UnitBox,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: box.x * width,
    y: box.y * height,
    w: box.w * width,
    h: box.h * height,
  };
}

/** Map a pixel box back to unit space. */
export function pxToUnit(
  box: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): UnitBox {
  return {
    x: box.x / width,
    y: box.y / height,
    w: box.w / width,
    h: box.h / height,
  };
}

/** True when the box is at least `minPx` wide and tall in source pixels. */
export function meetsMinPx(
  box: UnitBox,
  width: number,
  height: number,
  minPx = 48,
): boolean {
  const px = unitToPx(box, width, height);
  return px.w >= minPx && px.h >= minPx;
}

/** A media element the operator can crop from (a paused clip or a still). */
export type CropMedia = HTMLVideoElement | HTMLImageElement;

/** Native pixel size of a video's current frame or an image. */
export function mediaSize(m: CropMedia): { width: number; height: number } {
  return m instanceof HTMLVideoElement
    ? { width: m.videoWidth, height: m.videoHeight }
    : { width: m.naturalWidth, height: m.naturalHeight };
}

/**
 * Where an `object-fit: contain` frame of `natW`x`natH` lands inside a
 * `boxW`x`boxH` element (letterboxing included), in element pixels.
 */
export function containRect(
  boxW: number,
  boxH: number,
  natW: number,
  natH: number,
): { x: number; y: number; w: number; h: number } {
  if (boxW <= 0 || boxH <= 0 || natW <= 0 || natH <= 0)
    return { x: 0, y: 0, w: boxW, h: boxH };
  const scale = Math.min(boxW / natW, boxH / natH);
  const w = natW * scale;
  const h = natH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

/**
 * Draw the frame currently shown by the media element (the paused video frame
 * or the image) to a canvas at its native resolution. No scaling is applied,
 * so the crop keeps every source pixel.
 */
export function captureFrame(m: CropMedia): HTMLCanvasElement {
  const { width, height } = mediaSize(m);
  if (!width || !height) throw new Error("The frame is not loaded yet.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");
  ctx.drawImage(m, 0, 0, width, height);
  return canvas;
}

/**
 * Resolve once the media shows a decoded frame. A clip that is still seeking
 * (after a frame step) or has no current data would draw black or stale
 * pixels; a still that hasn't loaded would draw nothing.
 */
export function waitForFrame(m: CropMedia, timeoutMs = 5_000): Promise<void> {
  if (m instanceof HTMLImageElement)
    return m.complete && m.naturalWidth ? Promise.resolve() : m.decode();
  const ready = () =>
    !m.seeking && m.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = (settle: () => void) => {
      clearTimeout(timer);
      m.removeEventListener("seeked", onReady);
      m.removeEventListener("loadeddata", onReady);
      m.removeEventListener("error", onError);
      settle();
    };
    const onReady = () => ready() && done(resolve);
    const onError = () =>
      done(() => reject(new Error("The clip failed to load.")));
    const timer = setTimeout(
      () => done(() => reject(new Error("The frame is not loaded yet."))),
      timeoutMs,
    );
    m.addEventListener("seeked", onReady);
    m.addEventListener("loadeddata", onReady);
    m.addEventListener("error", onError);
  });
}

/** Cut the unit box out of the source canvas into a new full-resolution canvas. */
export function cropCanvas(
  src: HTMLCanvasElement,
  box: UnitBox,
): HTMLCanvasElement {
  const { x, y, w, h } = unitToPx(box, src.width, src.height);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(w));
  out.height = Math.max(1, Math.round(h));
  out.getContext("2d")!.drawImage(src, x, y, w, h, 0, 0, out.width, out.height);
  return out;
}

/** Encode a canvas as a JPEG blob for upload to VSS. */
export function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality = 0.9,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode the crop."))),
      "image/jpeg",
      quality,
    ),
  );
}
