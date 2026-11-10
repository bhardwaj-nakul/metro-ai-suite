// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { VssHit, VssStoredQuery, VssStream } from "@/adapters/vss/types";

/** Camera tags from the reference VSS deployment (Level 4 dataset). */
export const FIXTURE_TAGS = [
  "P_Lev_4_Entry_Way_ip_107",
  "P_Lev_4_External_Lift_foyer_ip_70",
  "P_Lev_4_External_Seating_area_ip_71",
  "P_Lev_4_Lift_6_ip_51",
  "P_Lev_4_Main_Entry_ip_54",
  "P_Lev_4_The_Cube_ip_72",
  "P_Lev_4_The_Cube_ip_74",
  "P_Lev_4_The_Cube_ip_92",
  "P_Lev_4_external_419_ip_52",
  "P_Lev_4_internal_stairs_ip_93",
  "P_Lev_4_lift_foyer_ip_55",
  "P_Lev_4_stairs_ip_95",
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Deterministic stand-in for a CCTV still (mock mode only): a corridor in
 * perspective with a figure in a blue jacket. Same seed gives the same frame.
 */
export function mockFrame(seed: string, withSubject = true): string {
  const h = hash(seed);
  const hue = 200 + (h % 40);
  const vx = 300 + ((h >> 3) % 260);
  const px = 140 + ((h >> 7) % 560);
  const scale = 0.7 + ((h >> 11) % 50) / 100;
  const py = 300 + ((h >> 13) % 60);
  const jacket = ["#1f5fbf", "#2a6fd6", "#1b4f9c"][h % 3];
  const person = withSubject
    ? `<g transform="translate(${px} ${py}) scale(${scale})">
  <ellipse cx="0" cy="118" rx="34" ry="7" fill="#000" opacity=".35"/>
  <circle cx="0" cy="-70" r="15" fill="#c9a98c"/>
  <path d="M-15 -78 q15 -16 30 0 v-4 q-15 -14 -30 0z" fill="#2b2118"/>
  <path d="M-26 -52 q26 -12 52 0 l8 70 h-68z" fill="${jacket}"/>
  <path d="M-26 -50 l-10 60 h9 l9-48z M26 -50 l10 60 h-9 l-9-48z" fill="${jacket}"/>
  <path d="M-20 18 h17 l-2 96 h-13z M3 18 h17 l-2 96 h-13z" fill="#2c2f36"/>
</g>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 856 480">
<defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 12% 34%)"/><stop offset="1" stop-color="hsl(${hue} 10% 22%)"/></linearGradient>
<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 8% 30%)"/><stop offset="1" stop-color="hsl(${hue} 8% 16%)"/></linearGradient></defs>
<rect width="856" height="480" fill="url(#w)"/>
<path d="M0 480 L${vx - 90} 230 H${vx + 90} L856 480Z" fill="url(#f)"/>
<path d="M${vx - 90} 230 V120 H${vx + 90} V230" fill="hsl(${hue} 14% 40%)" opacity=".6"/>
<path d="M0 0 L${vx - 90} 120 M856 0 L${vx + 90} 120 M0 480 L${vx - 90} 230 M856 480 L${vx + 90} 230" stroke="#fff" stroke-opacity=".08" stroke-width="2"/>
<rect x="${vx - 40}" y="140" width="80" height="90" fill="hsl(${hue} 30% 70%)" opacity=".18"/>
${person}
<rect width="856" height="480" fill="#000" opacity=".08"/>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const BASE_INGEST = Date.parse("2026-09-30T14:10:00Z");

interface HitSeed {
  tag: string;
  minutes: number;
  start: number;
  score: number;
  label?: string;
}

function buildHits(prefix: string, seeds: HitSeed[]): VssHit[] {
  return seeds.map((s, i) => {
    const rank = i + 1;
    const videoId = `${prefix}-${String(rank).padStart(2, "0")}-${hash(s.tag).toString(16).slice(0, 6)}`;
    return {
      matchId: `m${rank}`,
      rank,
      videoId,
      videoName: `${s.tag}-20140730-090000-chunk-0${10 + rank}.mp4`,
      cameraTag: s.tag,
      startS: s.start,
      endS: s.start + 8,
      seekS: s.start + 3,
      score: s.score,
      ingestedAt: new Date(BASE_INGEST + s.minutes * 60_000).toISOString(),
      fileName: `${s.tag}-20140730-090000-chunk-0${10 + rank}.mp4`,
      posterUrl: mockFrame(`${prefix}:${rank}`, s.label !== "none"),
      durationS: 300,
      detection: {
        label: s.label === "none" ? undefined : "person",
        confidence: 0.6 + (hash(videoId) % 35) / 100,
        timestamp: s.start + 3,
      },
    };
  });
}

const T = FIXTURE_TAGS;

export const MOCK_SEARCH_QUERY: VssStoredQuery = {
  queryId: "mock-q-search",
  query: "person in a blue jacket",
  status: "idle",
  tags: [],
  createdAt: new Date(BASE_INGEST + 50 * 60_000).toISOString(),
  hits: buildHits("srch", [
    { tag: T[4], minutes: 15, start: 24, score: 1 },
    { tag: T[10], minutes: 41, start: 96, score: 0.91 },
    { tag: T[1], minutes: 4, start: 280, score: 0.86 },
    { tag: T[5], minutes: 20, start: 160, score: 0.74 },
    { tag: T[2], minutes: 8, start: 56, score: 0.69 },
    { tag: T[0], minutes: 12, start: 8, score: 0.63 },
    { tag: T[8], minutes: 33, start: 216, score: 0.55, label: "none" },
    { tag: T[3], minutes: 13, start: 0, score: 0.52 },
  ]),
};

export const MOCK_QUERIES: Record<string, VssStoredQuery> = {
  [MOCK_SEARCH_QUERY.queryId]: MOCK_SEARCH_QUERY,
};

/** Live RTSP cameras for mock mode; stream_id doubles as the hit video_id. */
export const MOCK_STREAMS: VssStream[] = FIXTURE_TAGS.slice(0, 4).map(
  (tag, i) => ({
    streamId: `live${i}${hash(tag).toString(16).slice(0, 10)}`,
    name: tag
      .replace(/^P_Lev_\d+_/, "")
      .replace(/_ip_\d+$/, "")
      .replace(/_/g, " "),
    url: `rtsp://10.0.4.${50 + i}:8554/${tag.toLowerCase()}`,
    state: i === 3 ? "paused" : "running",
    description: "Level 4",
    tags: [tag],
    frameInterval: 15,
    objectDetection: true,
    framesProcessed: 12_000 + i * 731,
    embeddingsCreated: 30_000 + i * 1_913,
    lastFrameAt: Date.now() - (i === 3 ? 600_000 : 2_000),
    createdAt: BASE_INGEST + i * 60_000,
  }),
);
