// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** 83.4 -> "1:23" ; 3725 -> "1:02:05" */
export function formatOffset(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "--:--";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** Wall-clock time of a sighting: ingest time + offset into the clip. */
export function sightingTime(ingestedAt: string | undefined, offsetS: number) {
  if (!ingestedAt) return undefined;
  const t = Date.parse(ingestedAt);
  if (Number.isNaN(t)) return undefined;
  return new Date(t + offsetS * 1000);
}

/**
 * When a sighting happened: a live frame's observed time, else the clip's
 * ingest time + offset.
 */
export function hitTime(h: {
  observedAt?: string;
  ingestedAt?: string;
  seekS: number;
}): Date | undefined {
  if (h.observedAt) {
    const t = Date.parse(h.observedAt);
    if (!Number.isNaN(t)) return new Date(t);
  }
  return sightingTime(h.ingestedAt, h.seekS);
}

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatClock(d: Date | undefined): string {
  return d ? timeFmt.format(d) : "--:--:--";
}

export function formatDateTime(d: Date | number | string | undefined): string {
  if (d === undefined) return "";
  const date =
    typeof d === "number"
      ? new Date(d < 1e12 ? d * 1000 : d)
      : typeof d === "string"
        ? new Date(d)
        : d;
  return Number.isNaN(date.getTime()) ? "" : dateTimeFmt.format(date);
}

const dayFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

/** Calendar day of a sighting, e.g. "Sep 30". */
export function formatDay(d: Date | undefined): string {
  return d && !Number.isNaN(d.getTime()) ? dayFmt.format(d) : "";
}

/** Relative "5 min ago" for history lists. Accepts epoch seconds or ms. */
export function timeAgo(epoch: number | undefined, now = Date.now()): string {
  if (!epoch) return "";
  const ms = epoch < 1e12 ? epoch * 1000 : epoch;
  const diff = Math.max(0, now - ms) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

/** Elapsed time between sightings, e.g. "45 s", "3 min 05 s", "1 h 02 min". */
export function formatGap(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "unknown time";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600)
    return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
}
