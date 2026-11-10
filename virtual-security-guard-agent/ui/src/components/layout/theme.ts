// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

/** Same key next-themes used, so a saved choice carries over. */
const KEY = "theme";
const listeners = new Set<() => void>();

const stored = (): Theme =>
  localStorage.getItem(KEY) === "dark" ? "dark" : "light";

let current: Theme = stored();

function apply() {
  const root = document.documentElement;
  root.classList.toggle("dark", current === "dark");
  root.classList.toggle("light", current === "light");
  root.style.colorScheme = current;
  listeners.forEach((l) => l());
}

/**
 * Light/dark theme as a class on <html>, saved in this browser. Replaces
 * next-themes, whose inline <script> React 19 reports as an error (and the
 * CSP blocks anyway). Call once before the first render.
 */
export function initTheme() {
  apply();
  // Another tab changed it.
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    current = stored();
    apply();
  });
}

export function setTheme(t: Theme) {
  current = t;
  apply();
  localStorage.setItem(KEY, t);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => current);
  return { theme, setTheme };
}
