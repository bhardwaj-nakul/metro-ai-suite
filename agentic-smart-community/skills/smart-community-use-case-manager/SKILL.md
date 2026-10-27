---
name: smart-community-use-case-manager
description: "Manage Smart Community use cases and monitors. Simple existing detection event additions, removals and condition edits use get/dry_run/update with one business difference approval, never full registration. Schema is system-maintained and never a user design question. Apply every explicit supported prefilter parameter; preserve unspecified values."
homepage: https://github.com/open-edge-platform/metro-ai-suite
metadata:
  {
    "openclaw":
      {
        "emoji": "✍️"
      }
  }
---

# Smart Community Use Case Manager

Creates and registers Smart Community video-analysis use cases. This Skill owns
capability negotiation, internal output mode/schema/rules, registration, and
monitor binding. It does not contain domain definitions; those are compiled
into each use-case prompt from the user's business requirements.

## Fast updates of existing use cases and monitors

For an existing use case, use `references/update-use-case.md` and the
`get/update` actions. This flow takes precedence over new-case Q1/Q2,
authoring-after-design-approval, and monitor M1–M4 gates for updates that keep
the mode and binding. Read current state, draft only the changes, preview the
exact candidate, then obtain ONE later explicit confirmation of the differences
before committing. Do not repeat unchanged questions or regenerate unchanged
rules. Read-only get/dry_run calls are allowed before confirmation.
For prefilter-only changes use monitor `update_pipeline`; no prompt/rules
are authored and no VLM task is registered. Mode changes and task cloning are
outside this update flow. New creation uses the business design flow below. Binding retains its gates, but explicit parameters already supplied by the user must be honored without re-asking them.

## References

Read references only at their stated trigger:

- **After final approval, immediately before drafting/refining a prompt:**
  `references/prompt-authoring.md` — Detection Contract, runtime execution
  matrix, four-section template, semantic lint, and behavior validation.
- **Extended schema or custom alert behavior:**
  `references/evaluate-rules.md` — `evaluate_rules.py` contract and templates.
- **Incremental changes:** `references/update-use-case.md` — one difference confirmation, get/dry_run/update.
- **Overwrite/refine an existing use case:**
  `references/inspect-existing.md` — read its active schema and artifacts.
- **Binding a monitor with a stream URL:**
  `references/pipeline-config.md` — prefilter/ROI decisions, ROI template
  defaults, fetching `target_classes` from the model, and the pipeline-config
  confirmation gate.
- **Delete a use case:** `references/delete-use-case.md` — impact, confirmation, cascade verification.
- **Final report:** `references/final-report.md` — report blocks, inventory rendering, fallbacks.
- **MCP server unavailable:**
  `references/curl-fallback.md` — direct `/v1/tasks` task management only.

## Explicit parameter precedence

For new binding, user-provided prefilter/ROI switches and classes count as
explicit decisions; never repeat a question already answered in the request.
Extract every supported prefilter parameter per pipeline-config.md, merge
monitor_defaults first and explicit request values last. Numeric parameters
alone do not imply enabling prefilter. Existing pipeline-only changes bypass
M1–M4 and use the delta update flow. Schema approval is never a binding gate.

## Hard boundary — use the tools, never change the platform

Work only through the `smart_community_*` tools. Never edit the platform's source code or build files (the Agentic Smart Community checkout: `packages/`, `videostream-analytics/`, `docker/`, `skills/`, and so on), never build or rebuild images, and never restart or recreate containers or services. This applies even if it looks like the only way past an error.

If a tool call fails and its documented parameters cannot fix it, stop. Report the exact error text, what you already tried, and that the fix needs a change to the platform by the user. Do not read the platform source to work around it, and do not substitute shell commands for the tool.

## Hard tool-call gates

Quick index of the two irreversible tool calls. Each is forbidden unless every
predicate is true; the authoritative rules live in the referenced sections.

### `smart_community_use_case_register` (`generate_task` / `register`)

- necessary business requirements are resolved;
- the proposed Detection Contract and alert/report behavior were displayed;
- a still-later user turn explicitly approved that displayed design.

See **Question flow**, **Business design approval**, **Register (two steps)**.

### `smart_community_monitor_ctl action=register_source`

- `source_url` is known and the `use_case` is verified to exist (M0);
- P1 and P2 are explicit in the request or a clarification reply;
- the prefilter model and all required `target_classes` are complete (P1=yes),
  and P2=yes applies the ROI template defaults from the reference;
- the exact final `pipeline_config` was displayed (M3);
- a still-later user turn said exactly `confirm pipeline_config`;
- the config passed to the tool is identical to the approved one.

If any predicate is false or unknown, do not call the tool — return to the
corresponding gate. Full rules in **Monitor pipeline gates**.

## Data-model boundary

Before business design approval, determine whether the user needs:

- **Primary-event mode:** persist one primary event per clip; secondary visible
  observations may appear in `DESC`.
- **Multi-occurrence mode:** persist every simultaneous event/person occurrence
  independently.

Structured runtime currently supports primary-event mode only. If the user
needs multi-occurrence mode, stop before drafting/registration and explain that
it requires a different ingestion/data model. Never encode it as arrays,
slash-separated values, repeated `EVENT:` lines, or unqueryable prose.

Also stop when the request requires per-person records, bounding boxes,
coordinates, exact counts, persistent trajectories, multilabel output,
calibrated confidence, structured time intervals, event graphs, or cross-camera
identity. Prompt wording cannot add these runtime capabilities.

Do not ask this as a Q0. Use primary-event mode unless the request explicitly
requires an unsupported capability above. For an explicit unsupported
requirement, stop and explain the limitation without adding a boundary question.

## Mode matrix

This table is authoritative. Later steps must not mix invariants across rows.

| Mode | Final Schema | LOCAL output | Rule path | Report source |
|---|---|---|---|---|
| Report-only | none | factual narrative; multiple findings allowed | none | completed `video_summary_tasks` |
| Base alerting | `severity, event, desc` | one primary EVENT | `defaultRuleEvaluator` | `alerts` |
| Extended alerting | base + internally derived extensions | one primary EVENT + extension fields | `evaluate_rules.py` | completed `video_summary_tasks` unless the user asks for `alerts` |

Product invariants:

- Detection targets are `EVENT` values, never schema columns.
- Extensions are incremental; they never replace `severity, event, desc`.
- Base alerting has no `evaluate_rules.py` and alerts on parsed
  `severity=warn|critical`.
- Any extended schema **must** have `evaluate_rules.py` generated from the
  complete Final Schema. Falling back to `defaultRuleEvaluator` is forbidden.
- Custom alert behavior also selects `evaluate_rules.py`, even with base schema.
- Report-only has neither structured fields nor an evaluator.

## Question flow

Schema is internal for creation and updates. Extract alerting/report needs from
explicit user requirements; ask whether alerts are needed only if ambiguous.
Never ask Q2, field names/types/required flags or user schema approval. Derive
only the internal fields necessary for supported business requirements, and
validate them with prompt/rules. Read-only state and capabilities may be read
before business approval. Existing updates follow update-use-case.md instead.

For remaining business details, resolve ordinary business ambiguity with conservative defaults:

- Use the behavior named by the user as the single primary detection event.
- Use `warn` for a detected policy/safety violation unless the user explicitly
  requested another severity or described visible immediate severe harm.
- Use `info` for non-alerting baseline, absence, and uncertainty events.
- Use severity-first primary-event priority: `critical > warn > info`.
- Derive minimum visible evidence and common look-alike exclusions narrowly
  from the named behavior.
- Do not invent critical escalation scenarios, special policies for adjacent
  behaviors such as vaping, extra business events, custom alert behavior, or
  persisted fields.

The capability stops in **Data-model boundary** still apply. Stop and explain
an unsupported requirement rather than turning it into a third question.
Never ask the user to write the prompt.

## Business design approval

Show detection events, evidence criteria, alert/report behavior and scope; obtain
explicit final approval after the proposed design was displayed. Clarify only
missing business requirements. Do not expose Final Schema or Rule Path as
user decisions. Existing event updates preview one difference instead.

## Defaults

- `video_summary_task = <use_case>_monitor`; omit the argument to use it.
- `use_case` must match `^[a-z][a-z0-9_]{1,63}$`.
- Base-alerting reports:
  `{ data_source: "alerts", default_type: "daily", filter: {} }`.
- Extended-alerting and report-only reports (pass explicitly):
  `{ data_source: "video_summary_tasks", default_type: "daily", filter: { status: "completed" } }`.
- Omit `summarize`; register supplies
  `{ method: "SIMPLE", processor_kwargs: { levels: 1, level_sizes: [-1], process_fps: 2 } }`.
- `persist: true` (tool default; mirrors into the booted `<data_dir>/config.yaml`
  — `<data_dir>` = `$SMART_COMMUNITY_DATA_DIR` or `~/.mcp-smart-community`);
  `overwrite: false` for creation; existing event edits use `update`.
- Never invent YAML fields such as `rules`, `alert_conditions`,
  `severity_levels`, or `cooldown_seconds`.

Default realtime execution is `SIMPLE`, `levels=1`: LOCAL determines persisted
fields and immediate alerts. MACRO/GLOBAL are used for aggregate reports;
T_MINUS affects only explicitly configured history modes. See
`references/prompt-authoring.md` for the full execution matrix.

## Draft and lint

1. Resolve necessary business requirements; schema stays internal.
2. Verify explicit approval of the displayed business design; otherwise return
   to **Business design approval**. Existing updates use their own preview flow.
3. Read `references/prompt-authoring.md`.
4. Build the approved Detection Contract from the request and conservative defaults.
5. Draft all four Skill-required sections:
   `GLOBAL_PROMPT`, `MACRO_CHUNK_PROMPT`, `LOCAL_PROMPT`, `T_MINUS_1_PROMPT`.
6. Run the reference's semantic lint and contract round-trip.
7. On Extended alerting/custom behavior, read `references/evaluate-rules.md`
   and create `evaluate_rules.py` from the complete Final Schema.

The Skill requires all four authored sections for predictable realtime/report
behavior. The VLM service itself requires GLOBAL + LOCAL and can auto-fill
MACRO/T_MINUS; do not rely on those generic defaults for registered use cases.

## Register (two steps)

Use only `smart_community_use_case_register`. Never manually POST `/v1/tasks`
while MCP is available.

Before either new-case registration step, verify explicit approval of the
business design. These steps are creation-only: existing event changes must use
get/update, never full registration or overwrite as an update fallback.

Common arguments: `use_case`, one-line English `description`, `persist: true`,
and `overwrite: false`.

### Step 1 — generate task and stage artifacts

Call `action=generate_task` with the complete `prompt_text`.

- Base alerting/report-only: omit `evaluate_rules_path`.
- Extended alerting/custom behavior: pass `evaluate_rules_content` when the
  agent is remote; use `evaluate_rules_path` only for a file that already
  exists on the MCP server host. These parameters are mutually exclusive.
- The server checks consistency, registers/updates the VLM task, and on success
  writes `<data_dir>/use-cases/<use_case>/prompt.md`; a rule file is staged beside it.
- It does not ALTER schema or update `use_case_dict`/config.

### Step 2 — register the use case

Call `action=register`, `persist=true`, and omit `prompt_text` and
`evaluate_rules_path`; the server auto-reads/auto-discovers staged artifacts.

- Applies the Final Schema idempotently.
- Injects the in-memory `use_case_dict` entry.
- Writes the booted config when persistence succeeds.
- Runs post-registration structural validation.

### `schema_extensions`

Normally omit it: Final Schema is inferred from LOCAL's UPPER_SNAKE output
lines. Pass it only to declare a non-text type or override a required flag, and
then list only internally derived extension fields needed for the business contract. Detection events, risk labels,
derived counts, and booleans not explicitly requested for persistence do not
belong here.

The consistency gate runs before side effects. In particular:

- Report-only must have no output KEY lines.
- Base alerting must match exactly `severity,event,desc`.
- Extended fields without `evaluate_rules.py` are rejected.
- Prompt fields and Final Schema must match exactly.
- Rules may read only Final Schema fields.

Do not continue to monitor binding until registration returns `ok:true`.

## Monitor pipeline gates

Mandatory whenever: the request includes a stream URL, or the user asks to
create/bind a monitor, add a camera or rebind a source. Existing pipeline-only
updates follow update-use-case.md and bypass these creation gates.

Monitor creation is **fail-closed**. Never call
`smart_community_monitor_ctl action=register_source` until every M0–M4
precondition is met. Do not treat server defaults, an empty `pipeline_config`,
recommendations, existing conventions or the agent's own judgment as user
decisions. Explicit request values are decisions and must not be re-asked.

Field formats, `prefilter_options` handling, ROI template defaults, config
examples, and the report template live in `references/pipeline-config.md`. **The M0–M4
gate semantics below are authoritative and must not be skipped even if that
reference is not read.**

Two separate cross-turn user gates:

1. **Pipeline Decision Gate** — the user explicitly answers P1/P2 and supplies
   every required selection/parameter.
2. **Pipeline Approval Gate** — after the exact `pipeline_config` is displayed,
   the user approves that displayed config in a later message.

A Decision reply can never approve a config that had not yet been displayed.

### M0 — Preconditions

Before starting monitor configuration:

1. Confirm that `source_url` and `use_case` are known.
2. Establish that the use case exists:
   - For a use case registered earlier in this same workflow, require that
     preceding `register` result to contain `ok:true`.
   - For a previously registered use case, call the authoritative use-case
     inventory (`smart_community_use_case_register action=list`) and verify the
     exact `use_case` key is present. The user's claim that it exists is not
     verification.
   - If existence cannot be verified, stop before M1 and report it.
3. Read `references/pipeline-config.md`.
4. Do not call `register_source`.

### M1 — Ask pipeline decisions and end the turn

Reuse explicit switches in the request. Ask only missing decisions, using:

```text
P1 — Prefilter: enable object-class prefiltering?
P2 — ROI focus: crop/focus a region of interest?
Reply exactly: P1=yes|no, P2=yes|no
```

Note that P1=yes later requires picking the prefilter model (when more than one
is selectable) and its `target_classes`, and P2=yes applies
the ROI template defaults (`mode: crop, expand: 0.25, auto_split_area: 0.35`;
see the reference) with no further ROI questions. **End the turn immediately.**

Explicit switches/classes supplied in the initial request are answers.
Not an answer: an inference, a recommendation, or a vague/conditional reply
("maybe", "if useful", "up to you", "看情况", "都行"). Before explicit decisions are available, do not assemble `pipeline_config`, call
`prefilter_options`, call `register_source`, or infer an answer. If missing or
ambiguous, ask only for the missing part and end the turn again.

### M2 — Resolve required selections and parameters

Continue after explicit decisions in the request or clarification reply.

* **P1=yes** — call `smart_community_monitor_ctl action=prefilter_options`, then
  resolve two selections in order (details in the reference):
  1. **Model.** `models[]` is the selectable set. Reuse a model the user already
     named in the request or a clarification reply if it is a returned `name`.
     Otherwise, if `models[]` holds **more than one** entry, list every model
     by `name` with its `description`, `input_shape` and class count, **end the
     turn**, and have the user explicitly pick one; the class list below
     depends on this choice, so do not show classes yet. If exactly one is
     selectable, use it and state which in the M3 summary. Never offer or
     accept a model listed only under `rejected`; never put a `model_path` in
     `pipeline_config` — models are chosen by `name`.
  2. **Classes.** Present the chosen model's `class_names` exactly, reuse
     supplied `target_classes`, or ask for the missing classes.

  Do not select for the user on either step; a recommendation is never a
  selection; the model must be a returned `name` and every class must match
  that model's `class_names`; handle `labels_source` per the reference.
  Continue only after the user's explicit selections.
* **P2=yes** — apply the ROI template defaults from the reference verbatim
  (`roi: { enabled: true, mode: crop, expand: 0.25, auto_split_area: 0.35 }`).
  No further ROI questions; there is no geometry to collect (ROI is
  trajectory-driven off prefilter hits). Change `mode`/`expand`/
  `auto_split_area` only when the user explicitly asks. If P1=no, warn that
  ROI has no trajectory source without prefilter and ask the user to enable
  prefilter or drop ROI (see the reference).
* **P1=no / P2=no** — record the feature as **explicitly disabled** (surface it
  in the M3 summary; never silently omit it).

### M3 — Display exact pipeline_config and end the turn

Only after all decisions/selections/parameters are complete:

1. Assemble the exact `pipeline_config` for `register_source` and display it in
   full — no hidden or summarized fields. When prefilter is enabled it carries
   `model: <name>` alongside `target_classes`.
2. Also display the decision summary (template in the reference).

Even when both features are off, display an **explicit** disabled config
(`prefilter.enabled=false`, `roi.enabled=false`). Never represent "both disabled"
by omitting `pipeline_config` or sending `{}` — that falls back to server
defaults and writes nothing to `monitors.yaml`, making a deliberate "off"
indistinguishable from "never configured". (Example in the reference.)

Then ask:

```text
Confirm this exact pipeline_config and create the monitor?
Reply `confirm pipeline_config` to continue.
```

**End the turn immediately.** In this turn do not call `register_source`, do not
claim the config is confirmed, do not treat the earlier P1/P2 reply as approval,
and do not modify the displayed config after asking. Silence, use-case-schema
approval, a completed plan item, or the agent's own statement never satisfies
this gate.

### M4 — Register source

Call `register_source` only after a later user message whose normalized text is
exactly `confirm pipeline_config` or `确认 pipeline_config`. A general
acknowledgement (`ok`, `looks good`, `continue`, `好的`, `可以`) or approval of
another part of the workflow does not satisfy this gate.

Immediately before the call, verify the conversation contains, in order:
(1) explicit pipeline decisions in the request or clarification; (2) any required
prefilter model and `target_classes` selection; (4) the turn displaying the exact
`pipeline_config`; (5) a later explicit approval of that displayed config. If any
item is absent, return to that state and do not call the tool. The config passed
must be identical to the approved one — if any field must change, redisplay and
repeat M3 (previous approval is void).

`register_source` is an **upsert** (existing `monitor_id` updated in place, new
one created); pipeline-only changes use update_pipeline. Choose `monitor_id`:

* **New default monitor** — omit `monitor_id` (yields `cam_<use_case>`).
* **Additional camera** — a custom `monitor_id` starting with `cam_`.
* **Update / rebind existing** — fetch it (`action=list`/`status`) and pass back
  its **exact existing** `monitor_id`; never omit it, never mint a new one.

Also pass a short English `name`; `source_url`, `use_case`, `persist:true`, and
the approved `pipeline_config`. Never use `<use_case>_monitor` as the ID.

### Monitor gate failure handling

Missing P1/P2 answer, prefilter model or target-class selection, or final approval:
stop and request exactly the missing item (redisplay the config for a missing
approval). Config changed after approval: void it and repeat M3. Never bypass a
gate by omitting `pipeline_config`, sending `{}`, relying on server defaults, or
calling a lower-level API — an explicit all-disabled config is the only way to
record "off", and it still requires M1–M4.

## Delete a use case (confirmation gate)

Deletion is destructive (entry removed, bound monitors unregistered, artifacts
archived) and requires a mandatory cross-turn confirmation gate.

1. On a delete request, read `references/delete-use-case.md`, fetch the real
   impact (`action=list` on both register and monitor tools), display it, and
   ask for explicit confirmation (e.g. `confirm delete <use_case>`). End the
   turn — the initial request is never confirmation, even when it says
   "delete", because the user has not yet seen the cascade impact.
2. Only after a later message explicitly confirms: `action=unregister` with
   `persist: true`, then verify `cascaded_monitors` per the reference.

## Validation and final report

Registration success proves structural validity, not detection quality. Apply
the minimum behavior-validation set in `references/prompt-authoring.md` when
representative media exists. Otherwise report **registered but behaviorally
unvalidated**.

Final response contains:

```text
New Use Case
  Use Case: <use_case>
  VLM Task: <use_case>_monitor
  Mode: report-only | base alerting | extended alerting
  Events/Findings: <...>
  Report Source: completed video_summary_tasks | alerts
  Monitor: cam_<use_case> -> <source_url>   # omit when no stream was supplied
  Validation: behaviorally validated | registered but behaviorally unvalidated
```

When the operation only created, rebound, or updated a monitor against an
already-registered use case (no new use case authored), use the monitor-scoped
report block instead of `New Use Case` (template in
`references/pipeline-config.md`).

Then report system inventory as ONE grouped view — use cases as headers,
bound monitors nested underneath — fetched from `action=list` on both tools;
format, example, and fallbacks per `references/final-report.md`.

## Failure handling

- A failed consistency report is authoritative; fix the named prompt/schema/rule
  mismatch and retry at most three times.
- Extended schema missing rules: create `evaluate_rules.py`; never drop fields
  or fall back to default merely to pass.
- Behavior names mistakenly supplied as extensions: move them to EVENT values.
- Format violations: remove generated fences, JSON/YAML/arrays/tables, `<<<`,
  repeated EVENT lines, and slash-separated values.
- Existing artifact conflict: read `references/inspect-existing.md`; use get/update for event changes; do not overwrite to bypass update validation.
- Do not bypass validation with direct DB edits or manual task POSTs.

## Intent mapping

| User request | Action |
|---|---|
| Create/register use case **without** stream URL | Collect name + description → capability check → resolve business needs and obtain business design approval → author → register → report. Do **not** start monitor configuration |
| Create/register use case **with** stream URL | Resolve business needs and obtain business design approval → author and register the use case → execute M0–M4 monitor pipeline gates → register monitor → report |
| Bind monitor to existing use case | Verify use_case exists (M0) + resolve source_url → execute M0–M4 monitor pipeline gates → register monitor → report |
| Add another camera | Verify existing use_case (M0) + source_url + custom `cam_` monitor_id → execute M0–M4 monitor pipeline gates → register monitor → report |
| Update/rebind monitor pipeline or source | Pipeline-only: status → delta preview → one difference approval → update_pipeline on the same monitor_id. Source rebind: existing M1–M4 → register_source |
| Preview only | Collect business requirements → show business design → receive approval → author/lint → preview; no registration |
| Add/remove detection events or edit an event condition | Read `update-use-case.md` → get → draft changes → dry_run → one difference confirmation → update |
| Delete use case | Fetch inventory → display cascade impact, ask confirmation, and end turn → receive explicit confirmation in a later message → `action=unregister`, `persist=true` → verify `cascaded_monitors` (see **Delete a use case (confirmation gate)**) |
| MCP unavailable task CRUD | Read `curl-fallback.md` |
