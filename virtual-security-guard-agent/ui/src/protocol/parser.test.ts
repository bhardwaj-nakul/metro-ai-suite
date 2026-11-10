// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { extractDirectives, parseAgentText } from "./parser";

const kinds = (text: string, streaming = false) =>
  parseAgentText(text, { streaming }).map((s) =>
    s.kind === "directive" ? s.directive.type : s.kind,
  );

describe("parseAgentText", () => {
  it("reads a one-line vsg-status without swallowing the next block", () => {
    const text =
      '```vsg-status {"v":1,"phase":"validate","message":"Found 3."}```\nFound 3.\n\n```vsg-matches\n{"v":1,"keep":["m1","m2","m3"]}\n```';
    const segs = parseAgentText(text);
    expect(kinds(text)).toEqual(["status", "text", "matches"]);
    expect(segs[1]).toEqual({ kind: "text", text: "Found 3." });
    const matches = extractDirectives(text).find((d) => d.type === "matches");
    expect(matches?.type === "matches" && matches.data.keep).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
  });

  it("reads a body that starts on the fence line and ends below it", () => {
    const text = '```vsg-status {"v":1,\n"phase":"search"}\n```\nDone.';
    expect(kinds(text)).toEqual(["status", "text"]);
  });

  it("still reads the multi-line form with an info string", () => {
    const text = 'Hi.\n```vsg-matches json\n{"v":1,"keep":["m1"]}\n```';
    expect(kinds(text)).toEqual(["text", "matches"]);
  });

  it("ends an unclosed block at its JSON, so later prose and blocks show", () => {
    const text =
      '```vsg-status\n{"v":1,"phase":"validate"}\nFound 3.\n```vsg-matches\n{"v":1,"keep":["m1"]}\n```';
    const segs = parseAgentText(text);
    expect(kinds(text)).toEqual(["status", "text", "matches"]);
    expect(segs[1]).toEqual({ kind: "text", text: "Found 3." });
  });

  it("keeps the prose after an unclosed block at the end of a reply", () => {
    const text =
      'Searching.\n```vsg-matches\n{"v":1,"keep":["m1"]}\nReview the clips below.';
    expect(kinds(text)).toEqual(["text", "matches", "text"]);
  });

  it("marks an unclosed block without JSON as not closed", () => {
    const segs = parseAgentText("```vsg-matches\nkeep m1 and m2");
    expect(segs).toEqual([
      {
        kind: "invalid",
        fence: "vsg-matches",
        raw: "keep m1 and m2",
        error: "Block was not closed",
      },
    ]);
  });

  it("shows a pending chip for a block still streaming, never raw JSON", () => {
    expect(
      kinds('Found.\n```vsg-matches\n{"v":1,"keep":["m1"]}', true),
    ).toEqual(["text", "pending"]);
    expect(kinds('```vsg-status {"v":1,"phase":"se', true)).toEqual([
      "pending",
    ]);
    expect(kinds("Found 3.\n``", true)).toEqual(["text"]);
  });

  it("drops unknown vsg fences", () => {
    expect(kinds('A\n```vsg-tick\n{"v":1}\n```\nB')).toEqual(["text", "text"]);
  });
});
