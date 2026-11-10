---
name: vsg-dev
description: Develop, run, test, build, deploy and debug the Virtual Security Guard Agent (VSG) UI - the React operator console for the Argus agent on Hermes over Intel VSS. Covers the Makefile targets, mock vs live dev servers, the nginx allowlist gateway, Zustand stores, the vsg-* directive protocol, the review grid, crop, route and live camera search flow, Playwright e2e, and reinstalling the Hermes skills. Use this whenever the user works in virtual-security-guard-agent or mentions VSG, Argus, the operator console, review grid, live search, floorplan route or incident report PDF - including "run the VSG UI", "add a feature/page to VSG", "Argus reply not shown", "add a VSS/Hermes route", "change the Argus protocol", "redeploy vsg-ui", React error 185, or any VSG UI bug - even if they do not name the skill.
license: Apache-2.0
metadata:
  version: "2026.4.0"
  tags: "vsg argus hermes vss react development"
---

<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# VSG Dev

Work on the Virtual Security Guard Agent UI through its real interfaces: the
`Makefile`, `deploy/compose.yaml`, the nginx gateway in `ui/nginx/`, and the
Hermes and VSS APIs behind it. Run commands yourself and relay the output.

Background: [`../../copilot-instructions.md`](../../copilot-instructions.md)
(what the app is, repo map). Design detail:
[references/design.md](references/design.md).

## Ground rules

These come from how the maintainer works; breaking them creates rework.

- **Leave changes unstaged.** Do not `git add`, commit, stash or reset. The
  maintainer keeps their own staged work and opens PRs themselves.
- **Simplify, don't add options.** The app is pre-release and was deliberately
  cut down to reduce QA risk. There are no migration or back-compat paths. Do
  not bring back removed features (see "Removed on purpose" below); if a
  request implies one, say so and propose the simplest alternative.
- **Agree design changes first.** For UX or flow changes with real choices,
  settle them with the user one question at a time before editing.
- Never print, log or commit `HERMES_API_KEY`, `deploy/.env` or
  `ui/.env.local`. nginx (and the Vite proxy in dev) adds the key
  server-side; the browser never sees it.
- SPDX header on every new source, config and doc file.

## Environment setup (run first)

The app root contains `Makefile`, `hermes-skills/` and `ui/src/`. It sits in
the `metro-ai-suite` repo, or is the repo root after a repo split:

```bash
TOP="$(git rev-parse --show-toplevel)"
for d in "$TOP/virtual-security-guard-agent" "$TOP"; do
  [ -f "$d/Makefile" ] && [ -d "$d/ui/src" ] && [ -d "$d/hermes-skills" ] && APP_ROOT="$d" && break
done
cd "$APP_ROOT"
```

Run `make` targets from the app root and `npm`/`npx` from `ui/`. Install
dependencies only when `ui/node_modules` is missing or `ui/package-lock.json`
changed: `make install`.

## 1. Choose how to run it

| Goal | Command | Needs |
|---|---|---|
| Offline UI work with scripted Argus + VSS | `make dev-mock` | nothing |
| Dev server against real Hermes/VSS | `cp ui/.env.example ui/.env.local`, fill it, `make dev` | `ui/.env.local` |
| Production container | `cp deploy/.env.example deploy/.env`, fill it, then `make up` | `deploy/.env` |

`make up` runs `${REGISTRY}intel/vsg-ui:${TAG}` from `deploy/.env`: the local
image if present, else a pull, else a build. To test code changes, run
`make build` first (or `docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build`).
The container listens on `VSG_UI_PORT` (default `12346`).
The floorplan is loaded at runtime from `deploy/floorplans/<VSG_FLOORPLAN>.json`
(default `simple`) and served as `/floorplan.json`.

## 2. Health check before debugging a deployment

```bash
P=${VSG_UI_PORT:-12346}
for u in /healthz /hermes/health /vss/manager/health; do
  printf '%-22s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:$P$u)"
done
```

All three must return `200`. If `/hermes/health` or `/vss/manager/health`
fails, the upstream is down or `deploy/.env` points at the wrong host; fix that
before touching UI code. VSS problems belong to the VSS skills (see "Out of
scope").

## 3. Change code

Find the owning module before editing:

| Area | Files (under `ui/src/`) |
|---|---|
| Chat run, phases, operator turns | `stores/investigation.ts`, `investigation.logic.ts`, `features/agent/Turns.tsx`, `MessageList.tsx` |
| Grounding (grid hits from the tool result) | `protocol/grounding.ts`, `features/agent/useDirectiveHits.ts` |
| Review grid (confirm-only, six shown, "Show more" up to 20, only the latest grid editable) | `features/agent/ValidationGrid.tsx`, `MatchCard.tsx`, `useSubmitReview.ts`, `stores/investigation.ts` (`reviews`) |
| Crop and re-search | `features/agent/ClipPlayerDialog.tsx`, `CropTool.tsx`, `lib/crop.ts` |
| Route and floorplan | `stores/case.ts` (`confirmedSightings`), `hooks/useRoute.ts`, `stores/floorplan.ts`, `features/map/SpatialMap.tsx` |
| Live camera search (button start, 10 s poll, live timeline, Stop) | `stores/watch.ts`, `stores/liveTimeline.ts`, `features/agent/LiveWatch.tsx`, `LiveTimeline.tsx` |
| Reports / PDF | `features/agent/ReportCard.tsx`, `features/reports/` |
| Live cameras page (VSS `/streams`) | `stores/cameras.ts`, `features/cameras/` |
| Hermes or VSS HTTP calls | `adapters/{hermes,vss}/` (`http.ts` and `mock.ts` together) |
| Argus protocol | `protocol/` - see [references/protocol.md](references/protocol.md) |
| Confirm dialogs | `components/shared/ConfirmDialog.tsx` |

Rules that prevent bugs this app has already hit:

- **Stable selectors.** A Zustand selector must not return a fresh object or
  array (`s.x ?? []`); hoist a module-level constant. Otherwise React error
  #185 (maximum update depth).
- **No cross-clock comparisons.** VSS and browser clocks differ. Don't filter
  or age VSS timestamps against `Date.now()`; compare VSS values with each
  other or measure change between polls.
- **Ground hits in tool results.** Grid hits come only from the run's
  `vss_search_video` result (`groundingForRun`), never from the model's JSON.
  A failed transcript read shows Retry, not an empty grid.
- **Operator consent.** A live search starts only from the route card button.
  Argus never starts one.
- **Surface failures.** No `.catch(() => fallback)` that hides an error from
  the operator; show the error in the UI.
- **Destructive actions** use `ConfirmDialog` or an Undo toast.
- **Wording.** The UI says "camera", not tag or position.
- **New upstream route.** Add it in three places, each with a strict regex:
  `ui/nginx/templates/default.conf.template`, the Vite proxy in
  `ui/vite.config.ts` (if not already covered), and the adapter + mock. Check
  the template first; some VSS routes (`tags`, `app/features`) are already
  allowed.
- **Hermes session titles must be unique.** `createSession` retries with a
  suffix; keep that.

### Removed on purpose

Do not reintroduce these; they were cut to simplify the app:

- the `vsg-track` directive, the trace store, `rebuild.ts`, and old-session
  compat code;
- the keymap dialog, the PhaseStepper, and the Samples menu;
- the composer's "All cameras" / "Any time" pickers and report chips (cameras
  and times go in the prompt text; report presets are a menu on the route
  card);
- tag editing, `camera_id` and `label` on floorplan cameras (the camera name
  is the VSS tag), and a Name field in Add live camera;
- the live-search offer card, "Not now", reject for live hits, and the
  "4 best" live grid (the live timeline replaced it).

## 4. Verify

From `ui/`, run the checks that cover the change while iterating, then all of
them before handing off:

```bash
npm run format
npx tsc -p tsconfig.app.json --noEmit
npx eslint .
npx vitest run
npx playwright test --reporter=line   # e2e on the mock adapters, port 5174
npm run build
```

- Playwright starts its own mock dev server on `VSG_E2E_PORT` (default
  `5174`). To activate an SVG floorplan node, use `.press("Enter")`, not a
  click; zone paths intercept clicks.
- Live smoke against a running deployment (optional):
  `VSG_LIVE_BASE=http://127.0.0.1:12346 npx vitest run src/test/live.smoke.test.ts`
- For visual changes, take a headless screenshot (Playwright's Chromium) and
  look at it before claiming success.

Report what you ran and the result. If something fails, show the failure; do
not call the change done.

## 5. Redeploy

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:${VSG_UI_PORT:-12346}/argus
```

## 6. Protocol or Argus behaviour changes

When you change what Argus is asked to do or a `vsg-*` schema, update these
together, because Argus reads the skills and the UI parses the result:

1. `ui/src/protocol/directives.ts` (Zod schema) and `instructions.ts`
   (per-run instructions sent with every run). Update their tests.
2. `hermes-skills/virtual-security-guard/SKILL.md` (+ `references/`) and,
   for reports, `hermes-skills/vsg-incident-report/`.
3. [references/protocol.md](references/protocol.md) (and
   [references/design.md](references/design.md) if the flow changes).
4. Tell the user to reinstall on the **Hermes host**, then start a new Hermes
   session:
   `make install-skills INSTALL_ARGS=--exclusive`
   (`--exclusive` moves all other skills aside so they don't compete with
   Argus). Run it yourself only if this machine is the Hermes host.

## 7. Debug "Argus replied but the UI shows nothing / wrong"

1. Read the raw transcript with the key from `deploy/.env`, without echoing
   it: `GET $HERMES_BASE_URL/api/sessions?limit=3`, then
   `GET /api/sessions/<id>/messages`. Check whether the assistant emitted a
   well-formed `vsg-*` block and which tools ran.
2. If the block looks valid, feed the exact text to `parseAgentText` in a
   scratch vitest file to confirm it parses. Delete the scratch file
   afterwards.
3. If it parses, the bug is in rendering or state: check `Turns.tsx`
   (`DirectiveView`), `MessageList.tsx` ordering, grounding, and store
   selectors.
4. If it does not parse, fix the schema leniency or the Argus instructions
   (section 6).

## Out of scope

- Deploying or fixing VSS, the VSS MCP server or RTSP streams. Use the VSS
  skills in the `edge-ai-libraries` repo under
  `sample-applications/video-search-and-summarization/.github/skills/`
  (for example `vss-troubleshoot`, `vss-search-index`).
- Installing VSS, Hermes or OVMS, or configuring the model. See
  `docs/user-guide/get-started/set-up-prerequisite-stack.md`.
