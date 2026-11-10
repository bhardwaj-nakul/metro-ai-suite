// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from "react";
import type { VssHit } from "@/adapters/vss/types";
import { getThumbnail } from "@/lib/thumbnails";

export type ThumbState =
  | { status: "loading" }
  | { status: "ready"; src: string }
  | { status: "error" };

/** Grabbed frames re-made after their blob URL stopped loading. */
const MAX_REGRABS = 1;

/**
 * Poster for a sighting: mock still, or a grabbed frame at the best timestamp.
 * `onImageError` is for the <img>: a grabbed frame the thumbnail cache has
 * since evicted (and revoked) is grabbed again; anything else is an error.
 */
export function useThumbnail(
  hit: Pick<VssHit, "posterUrl" | "playbackUrl" | "seekS"> | undefined,
): { thumb: ThumbState; onImageError: () => void } {
  const [state, setState] = useState<ThumbState>(() =>
    hit?.posterUrl
      ? { status: "ready", src: hit.posterUrl }
      : { status: "loading" },
  );
  const [regrab, setRegrab] = useState(0);
  const regrabs = useRef(0);
  const url = hit?.playbackUrl;
  const poster = hit?.posterUrl;
  const seek = hit?.seekS ?? 0;
  useEffect(() => {
    if (poster) {
      setState({ status: "ready", src: poster });
      return;
    }
    if (!url) {
      setState({ status: "error" });
      return;
    }
    let alive = true;
    setState({ status: "loading" });
    getThumbnail(url, seek).then(
      (src) => alive && setState({ status: "ready", src }),
      () => alive && setState({ status: "error" }),
    );
    return () => {
      alive = false;
    };
  }, [url, poster, seek, regrab]);
  const onImageError = useCallback(() => {
    if (!poster && url && regrabs.current < MAX_REGRABS) {
      regrabs.current++;
      setRegrab((n) => n + 1);
    } else setState({ status: "error" });
  }, [poster, url]);
  return { thumb: state, onImageError };
}
