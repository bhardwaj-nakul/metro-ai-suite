// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown", () => {
  it("keeps underscores inside words, such as camera tags", () => {
    const out = html("Both on the live P_Lev_4_Entry_Way_ip_107 camera.");
    expect(out).toContain("P_Lev_4_Entry_Way_ip_107");
    expect(out).not.toContain("<em>");
  });

  it("still renders _italic_ and *italic* at word boundaries", () => {
    expect(html("an _important_ note")).toContain("<em>important</em>");
    expect(html("(_aside_)")).toContain("<em>aside</em>");
    expect(html("a *quiet* note")).toContain("<em>quiet</em>");
  });

  it("renders bold and code", () => {
    const out = html("**Lobby** at `P_Lev_4_Main_Entry_ip_54`");
    expect(out).toContain("<strong>Lobby</strong>");
    expect(out).toContain("<code>P_Lev_4_Main_Entry_ip_54</code>");
  });
});
