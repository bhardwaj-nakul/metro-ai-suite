// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { Floorplan, FloorplanCamera } from "./schema";

export interface Size {
  width: number;
  height: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ZoneShape {
  name: string;
  /** SVG path data. */
  d: string;
  label: { x: number; y: number };
  outdoor?: boolean;
}

const PAD = 80;

// Loops, not Math.min(...xs): spreading a huge plan overflows the call stack.
const minOf = (xs: number[]) => xs.reduce((a, b) => Math.min(a, b), Infinity);
const maxOf = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), -Infinity);

/** Explicit canvas, or the camera bounding box plus padding. */
export function planSize(plan: Floorplan): Size {
  if (plan.canvas) return plan.canvas;
  const cams = Object.values(plan.cameras);
  const zonePts = (plan.zones ?? []).flatMap((z) =>
    z.points
      ? z.points
      : z.rect
        ? [[z.rect.x + z.rect.w, z.rect.y + z.rect.h] as [number, number]]
        : [],
  );
  const maxX = Math.max(
    0,
    maxOf(cams.map((c) => c.x)),
    maxOf(zonePts.map((p) => p[0])),
  );
  const maxY = Math.max(
    0,
    maxOf(cams.map((c) => c.y)),
    maxOf(zonePts.map((p) => p[1])),
  );
  return {
    width: Math.max(640, Math.ceil(maxX + PAD)),
    height: Math.max(400, Math.ceil(maxY + PAD)),
  };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Default heading: look towards the middle of the plan. */
export function cameraHeading(cam: FloorplanCamera, size: Size): number {
  if (cam.heading !== undefined && Number.isFinite(cam.heading))
    return cam.heading;
  const dx = size.width / 2 - cam.x;
  const dy = size.height / 2 - cam.y;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return 0;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** Field-of-view wedge as SVG path data. */
export function fovWedge(cam: FloorplanCamera, size: Size, range?: number) {
  const fov = Math.min(359.9, cam.fov_angle ?? 70);
  const r = cam.range ?? range ?? Math.min(size.width, size.height) * 0.12;
  const h = cameraHeading(cam, size);
  const a0 = rad(h - fov / 2);
  const a1 = rad(h + fov / 2);
  const p0 = [cam.x + r * Math.cos(a0), cam.y + r * Math.sin(a0)];
  const p1 = [cam.x + r * Math.cos(a1), cam.y + r * Math.sin(a1)];
  const large = fov > 180 ? 1 : 0;
  const f = (n: number) => n.toFixed(1);
  return `M${f(cam.x)} ${f(cam.y)} L${f(p0[0])} ${f(p0[1])} A${f(r)} ${f(r)} 0 ${large} 1 ${f(p1[0])} ${f(p1[1])} Z`;
}

function rectPath(r: Rect) {
  return `M${r.x} ${r.y} h${r.w} v${r.h} h${-r.w} Z`;
}

/**
 * Zones to draw. Explicit polygons/rects win; otherwise synthesise a padded
 * box around the cameras that share a `zone` name so a bare plan still reads
 * like a blueprint.
 */
export function zoneShapes(plan: Floorplan, size: Size): ZoneShape[] {
  if (plan.zones?.length) {
    return plan.zones.flatMap((z) => {
      if (z.points) {
        const d =
          z.points.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ") +
          " Z";
        const minX = minOf(z.points.map((p) => p[0]));
        const minY = minOf(z.points.map((p) => p[1]));
        return [
          {
            name: z.name,
            d,
            label: { x: minX + 10, y: minY + 20 },
            outdoor: z.outdoor,
          },
        ];
      }
      if (z.rect)
        return [
          {
            name: z.name,
            d: rectPath(z.rect),
            label: { x: z.rect.x + 10, y: z.rect.y + 20 },
            outdoor: z.outdoor,
          },
        ];
      return [];
    });
  }
  const groups = new Map<string, FloorplanCamera[]>();
  for (const c of Object.values(plan.cameras)) {
    if (!c.zone) continue;
    groups.set(c.zone, [...(groups.get(c.zone) ?? []), c]);
  }
  const pad = 56;
  return [...groups.entries()].map(([name, cams]) => {
    const minX = minOf(cams.map((c) => c.x)) - pad;
    const minY = minOf(cams.map((c) => c.y)) - pad;
    const maxX = maxOf(cams.map((c) => c.x)) + pad;
    const maxY = maxOf(cams.map((c) => c.y)) + pad;
    const r: Rect = {
      x: Math.max(8, minX),
      y: Math.max(8, minY),
      w: Math.max(140, maxX - minX),
      h: Math.max(100, maxY - minY),
    };
    r.w = Math.min(r.w, size.width - r.x - 8);
    r.h = Math.min(r.h, size.height - r.y - 8);
    return { name, d: rectPath(r), label: { x: r.x + 10, y: r.y + 20 } };
  });
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Left edge for a label box slid right until it clears every box (camera
 * dots and names), so a camera in a zone's corner doesn't print over the
 * zone name.
 */
export function clearLabelX(
  label: Rect,
  boxes: readonly Rect[],
  gap: number,
): number {
  let x = label.x;
  // x only grows, and a box once passed can't overlap again: this ends.
  for (let moved = true; moved;) {
    moved = false;
    for (const b of boxes)
      if (overlaps({ ...label, x }, b)) {
        x = b.x + b.w + gap;
        moved = true;
      }
  }
  return x;
}

/** Polyline through route points. */
export function routePath(points: { x: number; y: number }[]): string {
  return points
    .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
}

/** Midpoint + angle of each leg, for direction chevrons. */
export function legArrows(points: { x: number; y: number }[]) {
  const out: { x: number; y: number; angle: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    out.push({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    });
  }
  return out;
}
