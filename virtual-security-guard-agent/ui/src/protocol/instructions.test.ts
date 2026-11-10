// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { buildInstructions, type InstructionContext } from "./instructions";

const base: InstructionContext = {
  phase: "idle",
  cameras: [],
  freePositions: [],
  hasLiveCamera: false,
  minScore: 0.6,
  limit: 16,
};

describe("buildInstructions", () => {
  it("passes the search subject as the video-summary focus", () => {
    const text = buildInstructions({
      ...base,
      subject: "person in a blue jacket",
    });
    expect(text).toContain(
      "- Search subject (focus for video summaries): person in a blue jacket",
    );
  });

  it("omits the subject line when there is no description", () => {
    expect(buildInstructions(base)).not.toContain("- Search subject");
  });

  it("says when cameras or the floorplan could not be read", () => {
    const text = buildInstructions({
      ...base,
      cameras: { unavailable: "camera status unavailable: 502" },
      freePositions: { unavailable: "HTTP 404" },
    });
    expect(text).toContain(
      "- Live cameras: unavailable (camera status unavailable: 502)",
    );
    expect(text).toContain(
      "cameras (no live camera yet): unavailable (HTTP 404)",
    );
  });

  it("shows every block example on its own lines, never inline", () => {
    const text = buildInstructions(base);
    expect(text).toContain('```vsg-status\n{"v":1,"phase"');
    expect(text).not.toMatch(/```vsg-[a-z-]+ \{/);
  });

  it("gives a single concrete phase, not a pipe-separated template", () => {
    expect(buildInstructions(base)).not.toContain("search|validate");
  });
});
