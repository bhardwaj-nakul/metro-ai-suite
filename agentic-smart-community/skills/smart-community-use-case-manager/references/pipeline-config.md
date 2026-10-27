# Pipeline config for monitor binding

Operational detail for building, displaying, and reporting a monitor's
`pipeline_config`. **All cross-turn gate semantics (when to stop, what does not
count as an answer/approval, fail-closed rules) are defined in `SKILL.md` under
"Monitor pipeline gates" and are authoritative — this file never relaxes them.**
Read this file at M0; use it inside M2 (assembling fields) and M3 (display) and
in the monitor report.

`pipeline_config` is forwarded verbatim to videostream-analytics
`/register_source`. Omitting it entirely leaves the monitor on server defaults
(`motion` on, `prefilter` off, `roi` off) **and writes no `pipeline_config` to
`monitors.yaml`** — so a deliberate "off" becomes indistinguishable from "never
configured". Only two blocks are decided in this dialog — `prefilter` and
`roi`; leave every other field at its server default unless the user explicitly
asks.

## P1 — prefilter (field detail)

Prefilter drops motion clips that contain none of the target classes before they
reach the VLM, cutting false positives and cost. Enable it when the use case is
about specific objects/people; skip it when any motion is worth reviewing.

If enabled, fetch the available models and their classes — never hard-code
either:

```
smart_community_monitor_ctl action=prefilter_options
```

Returns `{ default_model, supported_kinds, supported_backends, available_devices,
models, rejected, defaults }`. `defaults` is the deployment-default prefilter
block (confidence, frame and fps thresholds, device, …) that a monitor inherits
for anything it does not set. Work through it in two steps.

To answer "what is a RUNNING monitor actually doing" (filtering at all? which
model? which classes?), read `smart_community_monitor_ctl action=status` —
its `analyticsPipeline` is the effective defaults←monitor merge VSA runs, so
a monitor that never configured `prefilter` shows the inherited default there.
Never infer this from `monitors.yaml` alone.

**P1a — pick the model.** `models[]` is the selectable set; each entry carries
`name`, `description`, `class_names`, `labels_source`, and `input_shape`.

- **One model available** → use it silently. Do not ask.
- **Several available** → name every one with its `description`, `input_shape`
  and class count, then **end the turn** and wait for the user's pick. Do not
  show class names until a model is chosen: the list depends on it. Mention
  `default_model` as the deployment default, but a recommendation is never a
  selection.
- A model listed under `rejected` is **not** selectable — it is a registered
  entry that failed validation. Never offer one. If the user asks for a model
  that is only in `rejected`, relay its `reason` and point them at the
  *Configure the Prefilter Model for a Monitor* how-to guide.
- The user wants a model that is registered nowhere (e.g. "我有一个 openvino
  模型放在 xxx，帮我注册/确认注册好了") → register it yourself:
  `smart_community_monitor_ctl action=register_prefilter_model` with
  `model=<name>` and `model_path=<absolute .xml path>` (optional `kind`,
  `backend`, `description`). The tool edits the VSA config file, hot-reloads
  VSA, and confirms: `selectable` → done, show the entry; `rejected` → relay
  the `reason` verbatim (missing .bin, not under `PREFILTER_MODEL_DIR`, not
  detection-shaped, …) and help the user fix it. A name already registered
  with different settings errors out — do not retry blindly; show the user the
  existing entry and let them decide.

Models are selected by **name**. Never put a `model_path` in
`pipeline_config` — the server rejects it with 422.

**P1b — pick the classes.** Present the chosen model's `class_names` and let the
user pick `target_classes`. Interpret `labels_source`:

- `embedded` — the list is authoritative (it came from the model). A class the
  user picks that is not in the list is rejected server-side with 422 at
  registration, so only offer names from `class_names`.
- `fallback_coco` — the model has no embedded labels; the list is a COCO-80
  **guess**. Warn the user and have them confirm the names explicitly.
- `unavailable` — the model's labels could not be read. Tell the user prefilter
  classes cannot be listed; either skip prefilter or proceed with names they
  supply at their own risk.

**Device note.** If the user asks for `device: NPU`, check the chosen model's
`input_shape`: a `?` in it means a dynamic shape, which the NPU plugin cannot
compile. Say so and offer `CPU`/`GPU` or a statically-shaped model instead.

Assemble as `prefilter: { enabled: true, model: <name>, target_classes: [<picked>] }`.

## P2 — ROI focus (field detail)

ROI helps scenes where the subject occupies a small, low-motion part of the
frame — e.g. child-safety, where a child covers little of the image and moves
subtly, so full-frame observation risks misdetection.

ROI is **trajectory-driven, not geometry-driven**: the prefilter's YOLO hits
accumulate a union bbox per segment, and the ROI crop is that trajectory region
expanded by `expand`. There is no geometry to collect from the user.

When the user answers `P2=yes`, apply the template defaults verbatim — no
further ROI questions:

```yaml
roi:
  enabled: true
  mode: crop            # zoomed-in view of the trajectory region
  expand: 0.25          # expand the trajectory bbox by 25% on each side
  auto_split_area: 0.35 # early-split the segment when the union bbox exceeds 35% of the frame
```

- `mode: crop` (default) — crop to the trajectory region only. Other modes
  (`highlight`, `crop_and_concat`) are advanced manual config; switch only when
  the user explicitly asks (e.g. the alert semantics depend on scene context
  that a crop would cut away).
- `expand` / `auto_split_area` tuning — advanced manual config only; change
  only when the user explicitly asks.

**Dependency:** the trajectory comes from prefilter hits, so ROI silently
no-ops when prefilter is disabled. If the user answers `P1=no, P2=yes`, warn
that ROI has no trajectory source without prefilter, and ask them to either
enable prefilter (recommended) or drop ROI. Never ship `roi.enabled=true` with
`prefilter.enabled=false`.

Assemble as `roi: { enabled: true, mode: crop, expand: 0.25, auto_split_area: 0.35 }`.

## Assemble the exact config

Build the block that will be passed verbatim to `register_source`.

Child-safety example (both features on):

```yaml
pipeline_config:
  prefilter:
    enabled: true
    model: yolo11s
    target_classes: [person, knife, scissors, bottle]
  roi:
    enabled: true
    mode: crop
    expand: 0.25
    auto_split_area: 0.35
```

**Explicit-off** (user answered `P1=no, P2=no`) — assemble and display the
disabled config explicitly; never omit `pipeline_config` and never send `{}`:

```yaml
pipeline_config:
  prefilter:
    enabled: false
  roi:
    enabled: false
```

## M3 decision-summary template

Alongside the exact `pipeline_config`, display this human-readable summary so a
deliberate "off" is provable:

```text
Monitor Pipeline Decision
  Prefilter: enabled | disabled
  Prefilter Model: <name> (<kind>, <backend>) | not applicable
  Target Classes: <classes> | not applicable
  Labels Source: <source> | not applicable
  ROI Focus: enabled | disabled
  ROI Parameters: defaults (mode=crop, expand=0.25, auto_split_area=0.35) | <custom parameters> | not applicable
```

## Monitor report template

For an operation that only created, rebound, or updated a monitor against an
already-registered use case (no new use case authored), use the monitor-scoped
report block instead of `New Use Case`:

```text
Monitor Created | Monitor Updated
  Monitor ID: <monitor_id>
  Use Case: <use_case>
  Source URL: <source_url>
  Prefilter: enabled | disabled
  Target Classes: <classes> | not applicable
  ROI Focus: enabled | disabled
  Pipeline Config: <exact approved config>
  Persistence: enabled
```

## Explicit prefilter parameters and fast updates

Extract all explicit supported parameters into pipeline_config.prefilter:

| Field | Constraint |
|---|---|
| enabled | boolean; explicit false must be preserved |
| target_classes | nonempty class-name array, validated against the selected model's `class_names` |
| min_confidence | finite number 0..1; explicit 65% becomes 0.65 |
| min_frames_hit | integer >=1 |
| detect_fps | finite number >0 |
| device | deployed OpenVINO device |
| model | a registry `name` returned by `prefilter_options` (never a path); only a selectable one is accepted. Omitted on an update keeps the monitor's current model |
| long_side | integer >=0; 0 disables resizing |

Never confuse confidence with VLM, severity, motion or IoU/NMS. Reject unknown
parameters; clarify ambiguous units. Unspecified values inherit deployed defaults
on creation and retain existing values on update. prefilter_options.defaults
exposes defaults; monitor status exposes effective pipeline_config. Explicit
values override recommendations and saved preferences. Do not materialize all
defaults into overrides. Preserve zero and false, and replace class arrays.

Display all requested values in the binding config and result, with their
source. An inactive prefilter can store numeric parameters; report them inactive
without implicitly enabling it. Resolve ROI dependencies explicitly. Without a
stream, save monitor_defaults and report saved for future binding. On binding,
merge preferences before explicit parameters; do not ask users to repeat supplied
switches or classes. Existing pipeline-only edits use update-use-case.md instead
of repeating M1–M4. Event edits without explicit parameters never change prefilter.
Global defaults and restore-default override removal are outside this flow.
