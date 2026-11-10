// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { create } from "zustand";

export interface GeneratedReport {
  id: string;
  title: string;
  fileName: string;
  createdAt: number;
  blobUrl: string;
  sessionId?: string;
}

interface ReportsState {
  reports: GeneratedReport[];
  add: (r: GeneratedReport) => void;
}

/**
 * PDFs built in this browser tab (report card or Reports > Download PDF),
 * listed in the case file of their investigation. Kept in memory only
 * (decision Q10), so they are lost on reload.
 */
export const useReportsStore = create<ReportsState>()((set, get) => ({
  reports: [],
  add: (r) => set({ reports: [r, ...get().reports] }),
}));
