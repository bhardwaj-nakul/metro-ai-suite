// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { pdfProse, stripMarkdown, toPdfText } from "./pdfText";

describe("toPdfText", () => {
  it("spells common symbols in ASCII", () => {
    expect(toPdfText("Lobby → Lift ≈ 2 min — “quick” ‘x’ – done…")).toBe(
      `Lobby -> Lift ~ 2 min - "quick" 'x' - done...`,
    );
    expect(toPdfText("• one\n▪ two")).toBe("- one\n- two");
  });

  it("keeps Latin-1 and replaces everything else with ?", () => {
    expect(toPdfText("Café °C £5")).toBe("Café °C £5");
    expect(toPdfText("red 🧥 jacket")).toBe("red ? jacket");
    expect(toPdfText("扶梯 مصعد")).toBe("?? ????");
    expect(toPdfText("👍🏽")).toBe("??");
  });

  it("drops joiners and variation selectors", () => {
    expect(toPdfText("a\u200db\ufe0f")).toBe("ab");
  });
});

describe("stripMarkdown", () => {
  it("removes headings, emphasis, code and links", () => {
    expect(
      stripMarkdown(
        "## Summary\n**Bold** and *italic* with `code`, [link](http://x) and ~~gone~~",
      ),
    ).toBe("Summary\nBold and italic with code, link and gone");
  });

  it("normalises list markers and leaves snake_case alone", () => {
    expect(stripMarkdown("* camera_1\n+ cam_2_b\n> quoted\n---")).toBe(
      "- camera_1\n- cam_2_b\nquoted\n",
    );
  });

  it("does not treat a multiplication star as emphasis", () => {
    expect(stripMarkdown("2 * 3 * 4")).toBe("2 * 3 * 4");
  });
});

it("pdfProse strips markdown then transliterates", () => {
  expect(pdfProse("**Lobby → Lift**")).toBe("Lobby -> Lift");
});
