// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { VssHit } from "@/adapters/vss/types";
import { useInvestigationStore } from "@/stores/investigation";
import {
  groundErrorFor,
  groundingFor,
  groundingPending,
} from "@/stores/investigation.logic";

const NONE: VssHit[] = [];

/**
 * Hits behind a vsg-matches directive: the vss_search_video result of the same
 * reply, read from the session transcript. Nothing the model wrote is shown.
 */
export function useDirectiveHits(turnId: string) {
  const grounded = useInvestigationStore((s) => groundingFor(s.turns, turnId));
  const isLoading = useInvestigationStore((s) =>
    groundingPending(s.turns, turnId),
  );
  const error = useInvestigationStore((s) => groundErrorFor(s.turns, turnId));
  const reground = useInvestigationStore((s) => s.reground);
  return {
    hits: grounded?.hits ?? NONE,
    queryId: grounded?.queryId,
    unreadable: grounded?.unreadable ?? 0,
    isLoading,
    error,
    retry: () => void reground(turnId),
  };
}
