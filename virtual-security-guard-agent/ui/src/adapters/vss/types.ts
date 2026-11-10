// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** One ranked sighting from a stored VSS search query, normalised for the UI. */
export interface VssHit {
  /** Directive ref: "m" + 1-based rank in GET /manager/search/:queryId. */
  matchId: string;
  rank: number;
  videoId: string;
  videoName?: string;
  /** Camera identity: the hit's VSS tag (one per camera), else a live hit's stream id. */
  cameraTag?: string;
  startS: number;
  endS: number;
  seekS: number;
  /** relevance_score; the cut-off is relative to the peak score of the query. */
  score: number;
  /** VSS ingest time of the clip (VDMS created_at). */
  ingestedAt?: string;
  fileName?: string;
  /** Same-origin clip URL (through the proxy). */
  playbackUrl?: string;
  /** Still image to use instead of grabbing a frame (mock mode). */
  posterUrl?: string;
  durationS?: number;
  detection?: { label?: string; confidence?: number; timestamp?: number };
  /** "live" for a frame from a registered RTSP camera. */
  source?: "live" | "video";
  /** Live camera that produced the hit (its stream_id = video_id). */
  streamId?: string;
  /** Wall-clock time of a live frame (ISO-8601 UTC). */
  observedAt?: string;
  /** Locator of the best-matching frame, for GET /manager/frames. */
  frame?: FrameLocator;
}

export interface FrameLocator {
  videoId: string;
  timestamp: number;
  mediaPath?: string;
  bucketName?: string;
  cropBbox?: string;
}

export type VssQueryStatus = "idle" | "running" | "error" | "unknown";

export interface VssStoredQuery {
  queryId: string;
  query: string;
  /** Query image as a data URL or same-origin path, when searching by image. */
  image?: string;
  status: VssQueryStatus;
  tags: string[];
  createdAt?: string;
  errorMessage?: string;
  hits: VssHit[];
}

/** A live RTSP camera registered with VSS (GET /manager/streams). */
export interface VssStream {
  streamId: string;
  name: string;
  /** Stream URL with any credentials redacted. */
  url: string;
  state: string;
  description?: string;
  tags: string[];
  frameInterval?: number;
  objectDetection?: boolean;
  detectionConfidence?: number;
  framesProcessed?: number;
  embeddingsCreated?: number;
  /** Epoch ms of the last ingested frame. */
  lastFrameAt?: number;
  error?: string;
  /** Epoch ms. */
  createdAt?: number;
}

export interface StreamInput {
  streamUrl: string;
  name?: string;
  description?: string;
  tags?: string[];
  frameInterval?: number;
  objectDetection?: boolean;
  start?: boolean;
}

/** A stream's name and tag are its floorplan position; they never change. */
export interface StreamPatch {
  state?: "running" | "paused";
  frameInterval?: number;
  objectDetection?: boolean;
}

export interface WatchStart {
  query?: string;
  /** Image reference from uploadImage (imageUrl). */
  imageUrl?: string;
  /** Rolling window of recent footage each refresh ranks. */
  windowMinutes?: number;
}

export interface VssFeatures {
  search: boolean;
  summary: boolean;
  imageSearch?: boolean;
}

export interface UploadedImage {
  imageId?: string;
  /** URL as returned by VSS; pass this to the agent. */
  imageUrl: string;
  /** Same-origin path the browser can display. */
  previewUrl: string;
}

export interface VssAdapter {
  health(): Promise<boolean>;
  features(): Promise<VssFeatures>;
  listTags(): Promise<string[]>;
  getQuery(queryId: string): Promise<VssStoredQuery>;
  uploadImage(file: Blob, filename?: string): Promise<UploadedImage>;
  listStreams(): Promise<VssStream[]>;
  addStream(input: StreamInput): Promise<void>;
  updateStream(streamId: string, patch: StreamPatch): Promise<void>;
  removeStream(streamId: string): Promise<void>;
  /** Create a persisted search (rolling window) and mark it watched. Returns its query id. */
  startWatch(req: WatchStart): Promise<string>;
  setWatch(queryId: string, watch: boolean): Promise<void>;
  /**
   * Best-effort unwatch while the page unloads (a keepalive request that
   * outlives the tab). Fire and forget: the result is never seen.
   */
  unwatchOnUnload(queryId: string): void;
}

export class VssError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "VssError";
    this.status = status;
  }
}

export const SEARCH_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const SEARCH_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
