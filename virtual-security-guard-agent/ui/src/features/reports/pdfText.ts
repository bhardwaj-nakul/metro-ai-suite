// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Common symbols the PDF's built-in Helvetica can't draw, as ASCII. */
const TRANSLIT: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "↔": "<->",
  "⇒": "=>",
  "≈": "~",
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
  "×": "x",
  "‘": "'",
  "’": "'",
  "‚": ",",
  "‛": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "′": "'",
  "″": '"',
  "–": "-",
  "—": "-",
  "‒": "-",
  "−": "-",
  "…": "...",
  "•": "-",
  "◦": "-",
  "▪": "-",
  "·": "-",
  "✓": "v",
  "✔": "v",
  "\u00a0": " ",
  "\u2009": " ",
  "\u202f": " ",
  "\t": "  ",
};

/**
 * Text that jsPDF's standard fonts draw as written. jsPDF switches the whole
 * string to a two-byte encoding the standard fonts can't show when it meets
 * any character above U+00FF, so common symbols are spelled in ASCII and
 * anything else outside Latin-1 (emoji, CJK, Arabic) becomes "?". Embedding a
 * Unicode font would be needed to print those.
 */
export function toPdfText(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const t = TRANSLIT[ch];
    if (t !== undefined) out += t;
    else if (
      ch === "\n" ||
      (ch >= " " && ch <= "~") ||
      (ch >= "¡" && ch <= "ÿ")
    )
      out += ch;
    else if (/\p{M}|\p{Cf}|\p{Cc}/u.test(ch))
      continue; // combining marks, variation selectors, joiners, controls
    else out += "?";
  }
  return out;
}

/** Markdown from Argus as plain text: no #, **, `, links or list markers. */
export function stripMarkdown(s: string): string {
  return s
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/^(\s*)[-*+]\s+/, "$1- ")
        .replace(/^\s*([-*_])(\s*\1){2,}\s*$/, ""),
    )
    .join("\n")
    .replace(/```[^\n]*\n?/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, "$1$2")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1");
}

/** Operator or Argus prose for the PDF. */
export const pdfProse = (s: string) => toPdfText(stripMarkdown(s));
