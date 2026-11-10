// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { persistStorage } from "@/lib/storage";

export interface SettingsState {
  sidebarOpen: boolean;
  caseFileOpen: boolean;
  /** Minimum VSS relevance score for a sighting to join the trace. */
  minTraceScore: number;
  /** Upper bound on hits Argus is asked to return per search. */
  searchLimit: number;
  /** Live watch stops after this many minutes. */
  watchMinutes: number;
  /** Live watch stops after this many minutes without a new sighting. */
  watchIdleMinutes: number;
  setSidebarOpen: (open: boolean) => void;
  setCaseFileOpen: (open: boolean) => void;
  setMinTraceScore: (v: number) => void;
  setSearchLimit: (v: number) => void;
  setWatchMinutes: (v: number) => void;
  setWatchIdleMinutes: (v: number) => void;
  reset: () => void;
}

export const SETTINGS_DEFAULTS = {
  sidebarOpen: true,
  caseFileOpen: true,
  minTraceScore: 0.6,
  searchLimit: 20,
  watchMinutes: 30,
  watchIdleMinutes: 10,
};

export type NumericSetting =
  "minTraceScore" | "searchLimit" | "watchMinutes" | "watchIdleMinutes";

/** Allowed range of each number setting; `int` ones are rounded. */
export const SETTINGS_LIMITS: Record<
  NumericSetting,
  { min: number; max: number; int: boolean }
> = {
  minTraceScore: { min: 0, max: 1, int: false },
  searchLimit: { min: 4, max: 50, int: true },
  watchMinutes: { min: 1, max: 240, int: true },
  watchIdleMinutes: { min: 1, max: 120, int: true },
};

/** `v` inside the setting's range; anything that isn't a number gives the default. */
export function clampSetting(key: NumericSetting, v: unknown): number {
  const { min, max, int } = SETTINGS_LIMITS[key];
  if (typeof v !== "number" || !Number.isFinite(v))
    return SETTINGS_DEFAULTS[key];
  const n = Math.min(max, Math.max(min, v));
  return int ? Math.round(n) : n;
}

/** Saved settings, checked again on load: a hand-edited or old value can't break the app. */
export function restoreSettings(stored: unknown) {
  const p = (stored ?? {}) as Record<string, unknown>;
  const bool = (k: "sidebarOpen" | "caseFileOpen") =>
    typeof p[k] === "boolean" ? p[k] : SETTINGS_DEFAULTS[k];
  return {
    sidebarOpen: bool("sidebarOpen"),
    caseFileOpen: bool("caseFileOpen"),
    minTraceScore: clampSetting("minTraceScore", p.minTraceScore),
    searchLimit: clampSetting("searchLimit", p.searchLimit),
    watchMinutes: clampSetting("watchMinutes", p.watchMinutes),
    watchIdleMinutes: clampSetting("watchIdleMinutes", p.watchIdleMinutes),
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...SETTINGS_DEFAULTS,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setCaseFileOpen: (caseFileOpen) => set({ caseFileOpen }),
      setMinTraceScore: (v) =>
        set({ minTraceScore: clampSetting("minTraceScore", v) }),
      setSearchLimit: (v) =>
        set({ searchLimit: clampSetting("searchLimit", v) }),
      setWatchMinutes: (v) =>
        set({ watchMinutes: clampSetting("watchMinutes", v) }),
      setWatchIdleMinutes: (v) =>
        set({ watchIdleMinutes: clampSetting("watchIdleMinutes", v) }),
      reset: () => set(SETTINGS_DEFAULTS),
    }),
    {
      name: "vsg.settings.v1",
      storage: persistStorage(),
      partialize: (s) => restoreSettings(s),
      merge: (stored, current) => ({ ...current, ...restoreSettings(stored) }),
    },
  ),
);
