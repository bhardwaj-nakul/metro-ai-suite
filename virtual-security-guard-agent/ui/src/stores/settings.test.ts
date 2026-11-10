// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { clampSetting, restoreSettings, SETTINGS_DEFAULTS } from "./settings";

describe("settings limits", () => {
  it("clamps and rounds number settings", () => {
    expect(clampSetting("searchLimit", 400)).toBe(50);
    expect(clampSetting("searchLimit", 1)).toBe(4);
    expect(clampSetting("watchMinutes", 12.6)).toBe(13);
    expect(clampSetting("minTraceScore", 0.55)).toBe(0.55);
    expect(clampSetting("watchIdleMinutes", Number.NaN)).toBe(
      SETTINGS_DEFAULTS.watchIdleMinutes,
    );
  });

  it("re-checks saved settings on load", () => {
    expect(
      restoreSettings({
        searchLimit: 9999,
        watchMinutes: "30",
        minTraceScore: -1,
        caseFileOpen: false,
        sidebarOpen: "yes",
      }),
    ).toEqual({
      ...SETTINGS_DEFAULTS,
      searchLimit: 50,
      minTraceScore: 0,
      caseFileOpen: false,
    });
    expect(restoreSettings(undefined)).toEqual(SETTINGS_DEFAULTS);
  });
});
