<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Investigate a Person

This guide walks through a full investigation with the VSG agent (Argus) on
its **Argus** page: search, review, crop and re-search, route, live search and report. The **Case file**
panel on the right shows the subject, the review counts and the route.

## 1. Start a search

1. Open `http://<HOST_IP>:12346/argus`. Click **New** to start a fresh
   investigation.
2. Describe the person, attach a photo with the image button (or drag and
   drop it), or both.
3. Press **Enter** or the send button.

VSG uploads the photo to VSS, creates a Hermes session for the investigation
and starts a VSG agent run. The VSG agent calls the VSS search tool and replies with a
short summary and a grid of potential matches. The search covers everything
VSS has indexed: uploaded videos and what the live cameras have already
recorded. Each match names its camera by tag (for example `camera_1`).

Your message appears on the right; a photo shows above it. The VSG agent's reply
appears on the left next to its eye icon: a short summary of what it searched
and found, then the review grid. The **Case file** panel on the right shows
the subject and the review counts.

Above each reply, chips show what the VSG agent did for that turn: skills loaded and
VSS tools called. With three or more, they are collapsed under **Used N
tools**; click it to expand them. Click a chip to see the start of that
tool's result.

## 2. Review the matches

The grid shows the **top six** matches, three per row. Each card has a frame
from the clip with the match ref (`m1`, `m2` …), the clip time and the VSS
relevance score on it, then the camera, its zone and the date, and a
**Confirm** button. A confirmed card turns green; a card marked as a false
positive turns grey. The VSG agent may mark the cards it recommends as **Argus pick**.

- Click **Show N more findings** to reveal six more at a time, up to **20**.
- Click a thumbnail to open the clip player.
- Click **Confirm** on every card that shows the subject. Anything shown but
  left unconfirmed is sent to the VSG agent as a false positive.
- Click **Save N confirmed**. If nothing matches, click **None match**. While
  matches are still hidden it reads **None match, show N more** and shows them
  first. Nothing is sent and no new search runs; the
  footer offers **Try another photo** and **Refine in chat** (describe
  clothing, name cameras or give a time range).
- If some VSS results could not be read, the grid says how many were left out.
  If none could be read, it shows **Retry**.

The footer counts what you confirmed, for example **3 confirmed of 9**, and
how many sightings this investigation already has.

Only the latest grid can be changed. Until you search again you can update it;
the button then reads **Update review** and replaces that grid's earlier
verdicts. Earlier grids stay visible, read-only, with the verdicts you sent.
A new grid starts with the sightings already on the route confirmed.

> [!NOTE]
> Argus can be wrong. Always confirm sightings against the footage before
> acting.

## 3. Play a clip

The clip player opens near full-screen at the matching segment. Below the
video it shows the match ref, the camera, the time, the segment range,
the relevance and the zone. The footer has **Pause & crop person** and
**Confirm**; **Confirm** works the same as on the card. Press **Esc** to close
the player.

## 4. Crop the person and search again

When a clip shows the subject clearly, use it as a better reference image:

1. In the clip player, click **Pause & crop person**. The frame freezes and is
   dimmed, and a toolbar appears at the bottom of the frame.
2. Drag a rectangle around the person. Its size in video pixels shows above
   it. Drag inside it to move it, **Redo** to
   draw again. Use **Frame** ‹ › to step to a sharper frame. **Esc** or
   **Cancel** leaves crop mode.
3. Click **Save crop** (or press **Enter**).

The crop is cut at the video's native resolution and uploaded to VSS. The VSG
agent runs an image search for it and a new grid appears. The crop becomes the
**Subject**: the subject is always the latest image you searched with (or, with
no image, your latest search prompt). It is the case file photo, the report
photo and what a live search looks for.

## 5. Trace the route

Once at least one sighting is confirmed, a **Route** card appears in the chat
and the case file lists the stops. The confirmed sightings from all grids are
de-duplicated and sorted by when they happened. The card stays in place for
the rest of the investigation and draws the route on a small floorplan:
**Replay** animates it camera-to-camera and **Open floorplan** opens the
**Floorplan** page. See
[Configure the Floorplan](./configure-floorplan.md) to map VSS cameras onto
your plan.

## 6. Live camera search (optional)

The Route card has **Start live camera search** while at least one live camera
is connected; the line beside it says how many cameras it watches and for how
long. Nothing is watched until you click it. With no live camera connected,
neither the console nor the VSG agent offers a live search.

- VSS watches live cameras for the subject and the UI polls every 10 seconds.
  The Argus logo's eye scans while the search runs.
- Sightings appear in a **live timeline**, newest first. Detections on one
  camera less than a minute apart are one sighting, with a start and end time
  (**now** while the person is still there) and a detection count. A new
  sighting is highlighted with a **New** badge for a few seconds.
- Click **Confirm** on a sighting to add it to the route as one stop. The map
  changes only when you confirm.
- **Stop live search** is always visible. When the search ends, the card
  shows how many sightings it found and how many you added; **Show timeline**
  opens the timeline read-only, and **Search again** adds to the same
  timeline. If VSS refuses to stop the search, the card shows **Retry stop**.
- VSS keeps no history of a live search, so this browser saves the timeline
  with the investigation: reopening it from **History** brings the timeline and
  its confirmed stops back. Another browser doesn't see it.
- The watch also stops itself after the **Live watch time limit** (default
  30 min) or when there has been no new sighting for **Stop when quiet for**
  (default 10 min). Change both on the **Settings** page.

Each timeline row shows a frame of the sighting, the camera, the start and end
time, the zone, the detection count and **Confirm** (**Confirmed** once added).

## 7. Write the report

On the Route card, click **Generate report** and choose **Handover report**,
**Escalation report** or **Short brief** (or ask the VSG agent in chat). Your message
shows one line; the sighting list sent to the VSG agent is under **Details**. The VSG agent
receives the time-ordered sightings with the movement between cameras and
replies with a draft:

- Read the draft in the chat. Use **Edit before export** to change it.
- Click **Generate PDF**, then **Download**. The PDF lists every confirmed
  sighting in time order, followed by a **Movement** section.

To steer the draft, type the request yourself, for example "Write a handover
report on the person in the black t-shirt".

![Handover report draft from the VSG agent](../_assets/report-draft.jpg "Report draft")

PDFs are built in the browser. The **Reports** page lists the latest report of
each past investigation.

![Reports page](../_assets/reports.jpg "Reports")

## 8. Reopen an investigation

Each investigation is a Hermes session. Click **History** to reopen or delete
one.

![Investigation history](../_assets/investigation-history.jpg "History")

## Investigation settings

The **Settings** page shows the connection status and the investigation
parameters. They are stored in the browser.

![Settings page](../_assets/settings.jpg "Settings")

| Setting | Default | Effect |
|---|---|---|
| Minimum score (of the top match) | `0.60` | Fraction of the best match's score a match needs to be shown for review, appear as a live sighting, and join the route. Lower shows more sightings but adds noise. |
| Matches per search | `20` | Candidates the VSG agent asks VSS for. The grid shows up to 20 of them that reach the minimum score. |
| Live watch time limit | `30` min | Live search stops by itself after this. |
| Stop when quiet for | `10` min | Live search stops after this long without a new sighting. |
| Show the case file | on | Side panel on wide screens. |

**Clear local data** removes what this browser stores: the floorplan, live
search timelines and these settings. Hermes sessions and VSS data are not
affected.
