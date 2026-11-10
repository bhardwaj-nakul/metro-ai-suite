// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal, safe markdown for agent prose: paragraphs, bullet/numbered lists,
 * headings (rendered as strong lines), **bold**, *italic* and `code`.
 * Builds React elements only, never injects HTML.
 */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  // `_` emphasis only at word boundaries (as in GFM), so tags like
  // P_Lev_4_Entry_Way_ip_107 keep their underscores.
  const re =
    /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|(?<![\p{L}\p{N}])_[^_\s][^_]*_(?![\p{L}\p{N}]))/gu;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith("**"))
      out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`"))
      out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className={cn("prose-argus", className)}>
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim());
        if (!lines.length) return null;
        const bullet = lines.every((l) => /^\s*[-*•]\s+/.test(l));
        const numbered = lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
        if (bullet || numbered) {
          const Tag = numbered ? "ol" : "ul";
          return (
            <Tag key={bi}>
              {lines.map((l, li) => (
                <li key={li}>
                  {inline(
                    l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""),
                    `${bi}-${li}`,
                  )}
                </li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => {
              const heading = /^#{1,6}\s+/.test(l);
              const content = inline(
                l.replace(/^#{1,6}\s+/, ""),
                `${bi}-${li}`,
              );
              return (
                <Fragment key={li}>
                  {li > 0 && <br />}
                  {heading ? <strong>{content}</strong> : content}
                </Fragment>
              );
            })}
          </p>
        );
      })}
    </div>
  );
}
