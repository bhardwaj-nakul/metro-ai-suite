// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { ReportDirective } from "@/protocol/directives";

export type ReportContent = Omit<ReportDirective, "v">;

/** Drop the protocol version from a vsg-report directive. */
export function toReportContent(d: ReportDirective): ReportContent {
  const copy: Partial<ReportDirective> = { ...d };
  delete copy.v;
  return copy as ReportContent;
}

export const PRESET_LABEL: Record<ReportContent["preset"], string> = {
  handover: "Shift handover",
  escalation: "Escalation",
  brief: "Brief",
};

export function reportFileName(title: string, at = new Date()) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const stamp = at.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `vsg-${slug || "incident"}-${stamp}.pdf`;
}
