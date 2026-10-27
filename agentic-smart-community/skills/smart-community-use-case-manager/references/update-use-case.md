# Fast detection event updates

Customer goal: simple event edits must finish faster than full registration.
Keep the existing mode, schema metadata, task name and monitor bindings. This
flow overrides creation questions and monitor gates for unchanged bindings.
Schema is internal: never ask users for column names, types or required flags.

1. Read `smart_community_use_case_register action=get,use_case=<name>` once for
   the complete entry, prompt/rules, bound monitors and revision.
2. Resolve the requested additions, removals or local condition edits from the
   existing prompt. Preserve all unaffected events and evidence requirements.
   Maintain final `detection_events` identifiers internally (infer original
   targets from the prompt if absent; exclude baseline/uncertainty outputs).
   An absent removal target or identical request is unchanged; do not author or
   submit writes. Clarify ambiguous targets only. Never submit an empty target
   list: removing the last event needs clarification about disabling the use
   case, not implicit unregister. Evaluate mixed additions/removals together.
3. Read prompt/rule authoring references under this update exception. Modify
   the complete four-section prompt coherently. Event values are not columns.
   For removal delete its criteria, examples, output choices and dedicated rule
   branches; preserve shared rules. For condition edits change only the target
   event. Author prompt and necessary rules together in at most one generation.
   Reuse unchanged rules and schema; do not send schema_additions/extensions.
4. Preview `action=update,dry_run=true,expected_revision=<revision>` with the
   modified prompt_text, final detection_events and only necessary rule changes.
   The tool rejects any prompt change submitted without detection_events, empty
   sets, baseline/uncertainty states (info severity), and declarations that do
   not match the candidate prompt's event contract; derive the set from the
   complete candidate yourself, never from user answers.
   Show added/removed/changed events, retained detections, alert changes and
   affected cameras. Do not show schema/rule-path design questions. Ask for
   ONE explicit confirmation of this business difference. Reuse unchanged
   decisions; clarify only missing data.
5. Commit the exact patch with dry_run=false, expected_revision and candidate_hash
   from preview, persist=true. Do not regenerate after approval. Conflict means
   read/preview again. Never fall back to generate_task, register (including
   overwrite=true), unregister, camera rebinding or schema DDL.
6. Verify persistence and structural validation; representative footage verifies
   new/retained detections and removed events no longer firing after the update
   boundary. Historical summaries/alerts stay unchanged. Structural checks alone
   do not establish detection accuracy. Report updated/unchanged, event changes,
   applied steps, errors/degraded recovery and timings; not “New Use Case”.

A full four-section VLM PATCH is compatible with incremental configuration
semantics. Event-only changes never restart analytics or alter prefilter.

## Explicit prefilter updates

Read effective monitor status and identify the scope; clarify multiple cameras
only when unspecified. Extract every explicit supported field: enabled,
model (a registry name from prefilter_options, never a path), target_classes,
min_confidence, min_frames_hit, detect_fps, device, long_side. Normalize explicit 65% confidence to 0.65. Preserve false and zero.
No dedicated prompt/rule generation or VLM CRUD. Unsupported IoU/NMS fields
must not be silently mapped or ignored. Consult pipeline-config.md for bounds.

Preview monitor_ctl action=update_pipeline,dry_run=true,monitor_id=<existing>,
pipeline_config={prefilter:{<explicit delta>}},persist=true. Unspecified values
are preserved. Show target and changed parameters, obtain one business difference
confirmation, then commit the same patch with expected_revision/candidate_hash.
Validation happens before stopping. Python briefly restarts only the affected
analysis pipeline; bindings remain. Identical values do not restart it.

Disabled prefilter may save numeric preferences without enabling detection;
state that they are inactive. Do not implicitly enable or alter ROI. No stream
yet: save monitor_defaults for future binding and report saved, not running.
For mixed event/parameter requests show both changes in one confirmation,
commit separately and report each result; the operations are not atomic together.
Measure complete active conversation time using the performance helper; mocked
unit-test timings cannot establish customer-facing speed improvements.
