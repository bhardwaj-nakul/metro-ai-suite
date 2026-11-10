// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import type { VssHit } from "@/adapters/vss/types";
import type { Verdict } from "@/stores/case";
import { useInvestigationStore } from "@/stores/investigation";

/** e.g. `P_Lev_4_Main_Entry_ip_54, video <uuid>, 176-184 s` */
function clipLabel(h: VssHit): string {
  const parts = [
    h.cameraTag,
    `video ${h.videoId}`,
    `${Math.round(h.startS)}-${Math.round(h.endS)} s`,
  ];
  return parts.filter(Boolean).join(", ");
}

/**
 * Send the latest grid's verdicts to Argus, with readable clip labels so the
 * model can ground the refs it records.
 */
export function useSubmitReview(
  turnId: string,
  queryId: string | undefined,
  hits: VssHit[],
) {
  const [sending, setSending] = useState(false);
  const submitReview = useInvestigationStore((s) => s.submitReview);

  async function submit(verdicts: Record<string, Verdict>) {
    if (sending) return;
    setSending(true);
    try {
      const labels: Record<string, string> = {};
      for (const ref of Object.keys(verdicts)) {
        const h = hits.find((x) => x.matchId === ref);
        if (h) labels[ref] = clipLabel(h);
      }
      await submitReview(turnId, verdicts, { queryId, labels });
    } finally {
      setSending(false);
    }
  }

  return { submit, sending };
}
