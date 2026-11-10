<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# `vsg-report` schema (protocol v1)

Mirrors `reportDirective` in `ui/src/protocol/directives.ts`.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `v` | `1` | yes | | Protocol version. |
| `title` | string, 1–160 chars | **yes** | | Subject + place, e.g. "Person in red hoodie — lobby to car park". |
| `preset` | `"handover"` \| `"escalation"` \| `"brief"` | no | `handover` | Unknown values fall back to `handover`. |
| `summary` | string | no | `""` | 1–3 sentences of plain text (the PDF does not render Markdown). |
| `subject` | string | no | `""` | Visual description only: clothing, items. |
| `timeline` | `{ref?, note}[]` | no | `[]` | `ref` = a confirmed sighting's `<video_id>@<start_s>` from the run instructions' time-ordered list. One entry per sighting, in time order. Entries without a matching ref are listed as "Additional notes". |
| `observations` | string[] | no | `[]` | Facts seen in the footage. |
| `actions` | string[] | no | `[]` | Recommended next steps. |
| `confidence` | `"low"` \| `"medium"` \| `"high"` | no | `medium` | See the rubric in `SKILL.md`. |
| `vss_query_id` | string | no | | Rarely needed: timeline refs (`<video_id>@<start_s>`) do not depend on a query. |

## Presets

| Preset | Audience | Shape |
|---|---|---|
| `handover` | Next shift | Full summary, every confirmed sighting in time order in the timeline, 2–4 actions. |
| `escalation` | Supervisor / responders | Lead with the latest known location and time; urgent actions first. |
| `brief` | Quick log entry | One-sentence summary, timeline optional, at most 1 action. |

## Minimal valid block

```vsg-report
{"v":1,"title":"Possible sighting at the main entry"}
```

## What the UI adds

The operator can edit every field before export. The PDF then includes the
header band, the subject image, the route map, one row per confirmed sighting
in time order (thumbnail, camera, date and time, score, your timeline note), a
Movement section (each leg between cameras and its elapsed time, first to last
seen), observations and actions.
Rejected sightings are never included.
