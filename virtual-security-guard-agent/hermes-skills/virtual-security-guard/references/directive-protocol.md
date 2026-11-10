<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# VSG directive protocol v1

The VSG UI reads fenced code blocks whose info string starts with `vsg-`.
Each block holds **one JSON object**. Blocks carry references only (match refs
and, when available, a VSS query id); the UI gets clip details itself.

The UI parser lives in `ui/src/protocol/directives.ts`. Keep this file in sync
with it.

## Common rules

- Put blocks **after** the prose. At most one block of each type per reply.
- JSON only: double quotes, no comments, no trailing commas.
- Always include `"v":1`.
- A **match ref** is `m<N>`: the 1-based position of a hit in the latest
  `vss_search_video` result (or the hit's `match_id` when the tool provides
  one). `m1` is the best hit.

## How the UI finds the hits

Hermes stores every tool result in the session transcript. After each run the
UI reads the `vss_search_video` result of the same reply from there, so the
agent never copies hits or ids. A `vsg-matches` block without a search in the
same reply shows no hits.

Refs in `keep`, `notes` and report timelines may also be a
`video_id` or `<video_id>@<start_s>`; refs that match nothing are ignored and
the grid then shows every hit.
- Unknown block types are ignored. A block that fails validation is shown to
  the operator as raw text with a "couldn't be displayed" note, so check the JSON.

## Agent → UI

### `vsg-matches`: candidates to review

| Field | Type | Required | Notes |
|---|---|---|---|
| `v` | `1` | yes | |
| `keep` | string[] | no | Refs worth reviewing, best first. Empty or missing = show all. |
| `note` | string | no | One line shown above the grid. |
| `notes` | object | no | Per-ref reason, e.g. `{"m2":"same backpack"}`. |

```vsg-matches
{"v":1,"keep":["m1","m2","m4"],"note":"Blue jacket near the entry and lobby.","notes":{"m4":"partly occluded"}}
```

### `vsg-report`: incident report

Defined by the `vsg-incident-report` skill (`references/report-schema.md`).

### `vsg-status`: optional progress line

```vsg-status
{"v":1,"phase":"trace","message":"Sightings verified; waiting for the operator to start a live search."}
```

`phase` is one of `search`, `validate`, `trace`, `report`, `idle`. The UI
shows `trace` as "Live search".

## UI → agent

### `vsg-context`: image and result limit attached to an operator prompt

```vsg-context
{"v":1,"image_url":"http://10.223.23.199:12345/datastore/video-summary/search-images/3f2a.jpg","limit":16}
```

Pass `image_url` to `vss_search_video` as `image`, and `limit` unchanged. Both
fields are optional. Cameras and time ranges come from the operator's text.

### `vsg-feedback`: operator verdicts

```vsg-feedback
{"v":1,"vss_query_id":"75e5c9bf-96af-43e0-92c7-5ccdbfd91c2b","confirm":["m2"],"reject":["m1","m4"]}
```

The prose above the block names each ref's clip, e.g.
`Confirmed m2 (P_Lev_4_Main_Entry_ip_54, video <video_id>, 176-184 s)`.
`vss_query_id` is present only when VSS confirmed the reviewed query.

- `confirm` not empty → the confirmed clips are verified sightings. Do not
  search again and send no block: summarise where and when the subject was
  seen, then offer a live camera search if a live camera is connected (see
  `SKILL.md`, step 3).
- `confirm` empty → don't search again; ask the operator to retry with a new image or a better description.
- Only the latest grid can be reviewed. A later `vsg-feedback` for it replaces
  the earlier verdicts for that grid (the operator updated the review).
  Confirms from all grids together form the session's confirmed sightings,
  listed in time order in the run instructions.

## Reserved

`vsg-tick` is reserved for live tracking. Do not emit it.
