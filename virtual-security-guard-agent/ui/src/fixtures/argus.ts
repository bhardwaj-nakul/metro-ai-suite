// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { lastDirective } from "@/protocol/parser";
import { MOCK_SEARCH_QUERY } from "./vss";

export interface ScriptedReply {
  /** `result` is the full tool output Hermes stores in the transcript. */
  tools: { tool: string; args: string; preview: string; result?: string }[];
  text: string;
}

/** A vss_search_video tool result as the VSS MCP server returns it. */
export const MOCK_SEARCH_RESULT = JSON.stringify({
  query_id: MOCK_SEARCH_QUERY.queryId,
  results: MOCK_SEARCH_QUERY.hits.map((h) => ({
    match_id: h.matchId,
    video_id: h.videoId,
    video_name: h.videoName,
    tags: h.cameraTag ? [h.cameraTag] : [],
    start_s: h.startS,
    end_s: h.endS,
    seek_s: h.seekS,
    score: h.score,
    created_at: h.ingestedAt,
  })),
});

const fence = (name: string, body: unknown) =>
  "```" + name + "\n" + JSON.stringify(body) + "\n```";

const MCP = "mcp__video_search_mcp__";

export const MOCK_REPORT = {
  v: 1,
  title: "Person in blue jacket, Level 4 walk-through",
  preset: "handover",
  summary:
    "A person in a blue jacket arrived at the external lift foyer, crossed the seating area, walked along the Entry Way past Lift 6 and the Main Entry, and was last seen in the lift foyer. Six sightings across six cameras were confirmed or traced.",
  subject:
    "Blue zip jacket, dark trousers, no visible bag. Walks at a normal pace and does not interact with anyone.",
  timeline: [
    { ref: "m5", note: "Waiting at the external lift foyer." },
    { ref: "m6", note: "Crosses the external seating area towards the doors." },
    { ref: "m2", note: "Walks along the Entry Way." },
    { ref: "m4", note: "Passes Lift 6 without stopping." },
    { ref: "m1", note: "Seen at the Main Entry, operator confirmed." },
    { ref: "m3", note: "Last seen in the lift foyer." },
  ],
  observations: [
    "No restricted doors were opened in the traced footage.",
    "Ordering follows VSS ingest time, which may differ from recording time.",
  ],
  actions: [
    "Keep the six clips for 30 days.",
    "Ask the day shift to check the lift foyer camera for later footage.",
  ],
  confidence: "medium",
  vss_query_id: "mock-q-search",
};

/** Deterministic Argus behaviour for offline demos and tests. */
export function scriptedReply(input: string): ScriptedReply {
  const feedback = lastDirective(input, "feedback");
  if (feedback) {
    // Confirmed clips are verified sightings: no further search (see SKILL.md).
    if (feedback.data.confirm.length)
      return {
        tools: [],
        text: `Possible sightings verified (${feedback.data.confirm.join(", ")}): seen at the external lift foyer, then the lift foyer. Start a live camera search?`,
      };
    return {
      tools: [],
      text: "Nothing matched. Try again with a different image, for example a cropped, clearer one, or a more specific description.",
    };
  }

  if (/\breport\b|handover|escalat|summar/i.test(input)) {
    return {
      tools: [
        {
          tool: "skill_view",
          args: '{"name":"vsg-incident-report"}',
          preview: "Loaded skill vsg-incident-report",
        },
      ],
      text: [
        "Here is a handover report built from the confirmed and traced sightings. Review it before you export the PDF.",
        "",
        fence("vsg-report", MOCK_REPORT),
      ].join("\n"),
    };
  }

  return {
    tools: [
      {
        tool: "skill_view",
        args: '{"name":"virtual-security-guard"}',
        preview: "Loaded skill virtual-security-guard",
      },
      {
        tool: `${MCP}vss_list_tags`,
        args: "{}",
        preview: '["P_Lev_4_Entry_Way_ip_107", "P_Lev_4_Main_Entry_ip_54", …]',
      },
      {
        tool: `${MCP}vss_search_video`,
        args: '{"query":"person in a blue jacket","limit":16}',
        preview: '{"query_id":"mock-q-search","hits":8}',
        result: MOCK_SEARCH_RESULT,
      },
    ],
    text: [
      "I searched all 12 Level 4 cameras. Six sightings look strong; two are weaker and one may not show a person at all.",
      "Please confirm the right sightings.",
      "",
      fence("vsg-matches", {
        v: 1,
        keep: ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"],
        note: "Top six score 0.6 or higher.",
        notes: { m7: "No person detected in the best frame." },
      }),
    ].join("\n"),
  };
}
