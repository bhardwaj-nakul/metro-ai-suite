---
name: vsg-incident-report
description: Write a Virtual Security Guard Agent incident report as one vsg-report block, built only from the sightings the operator confirmed. Use when the operator asks Argus for a report, investigation summary, handover note, escalation or brief after a VSG investigation. Not for summarizing a single video (virtual-security-guard does that with vss_summarize_video).
version: 2026.3.0
license: Apache-2.0
metadata:
  hermes:
    tags: [security, incident-report, cctv, vss]
    category: security
    related_skills: [virtual-security-guard]
---

<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# VSG incident report

The VSG UI turns your `vsg-report` block into an editable preview and then a
PDF with thumbnails, the route map and a sightings table. You supply the words;
the UI supplies the evidence.

## When to Use

- The operator asks for a report, investigation summary, handover, escalation or brief
  during or after a VSG investigation.
- Not for new searches; use `virtual-security-guard` for those.

## Procedure

1. Pick the preset from the operator's wording:
   - `handover`: shift change, "for the next guard", or nothing specific (default).
   - `escalation`: "escalate", "for the manager", "police", "urgent".
   - `brief`: "short", "quick", "one-liner".
2. Collect the facts from **this session only**:
   - the **Confirmed sightings, in time order** list in the run instructions
     (or the report request). It covers every grid the operator reviewed,
     plus confirmed live sightings. Each line has the time, the camera, a
     `ref` (`<video_id>@<start_s>`), the score, and the movement from the
     previous sighting (for example "moved from Lobby in 3 min 05 s");
   - the operator's notes.
3. Write one or two sentences of prose, then exactly one `vsg-report` block
   (schema: `references/report-schema.md`):

````
```vsg-report
{"v":1,"title":"Person in blue jacket — Level 4 entry to back exit","preset":"handover","summary":"A person in a dark blue jacket with a black backpack was confirmed at the main entry and then seen at three more cameras, ending at the back exit.","subject":"Dark blue jacket, grey trousers, black backpack.","timeline":[{"ref":"a1b2c3@176","note":"13:02:56 enters through the main entry."},{"ref":"d4e5f6@42","note":"13:05:10, 2 min 14 s later, walks along the main corridor."},{"ref":"a7b8c9@310","note":"13:09:40, 4 min 30 s later, leaves by the back exit."}],"observations":["Did not stop at reception.","Backpack carried throughout."],"actions":["Check the back exit door log.","Brief the next shift to watch the back exit."],"confidence":"medium"}
```
````

4. Don't repeat the block's content in prose. Say the report is ready to review.

If there are no confirmed sightings yet, don't emit a block. Say a report needs at
least one confirmed sighting and offer to continue the search.

## Rules

- One timeline entry per confirmed sighting, in the listed time order. Use
  that line's `ref` (`<video_id>@<start_s>`) exactly. The UI attaches each
  note to that sighting's row.
- Describe the movement with the real times and gaps from the list ("2 min 14
  s later at the corridor camera"). Don't invent times or a route between
  cameras that are not listed.
- Use only what was observed. No speculation about intent, identity or
  traits; follow the `virtual-security-guard` guardrails.
- Use "possible" for anything the operator did not confirm.
- Short sentences, plain text (no Markdown). `summary` at most 3 sentences; `brief` preset: 1.
- `actions` are concrete next steps for staff (check a door log, review
  another camera, notify a supervisor). No legal conclusions.
- If the operator gave extra instructions ("mention the open door"), include
  them where they fit.

## Confidence rubric

| Value | When |
|---|---|
| `high` | At least 3 confirmed sightings with score ≥ 0.8 across 2+ cameras. |
| `medium` | 2–3 confirmed sightings, or scores mostly 0.6–0.8. |
| `low` | A single confirmed sighting, or gaps/occlusion the operator flagged. |

## Pitfalls

- Invalid JSON hides the report. Double quotes only, no trailing commas.
- `title` is required (max 160 characters). Everything else has defaults.
- Don't paste image URLs or clip URLs; the UI adds the images.

## Verification

The UI shows a report card with a preview and a "Generate PDF" button for the
turn. If it shows "couldn't be displayed", fix the JSON and send the block again.
