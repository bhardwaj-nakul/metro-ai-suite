# Reference and Troubleshooting

Configuration reference, internals, capabilities, limitations and troubleshooting for
the Milestone XProtect integration.

## Configuration reference

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `AIB_HOST` | — | AI Bridge host address. |
| `AIB_GRAPHQL_PORT` | `4000` | AI Bridge GraphQL port (debug mode). Use the proxy port in production. |
| `AIB_TLS_VERIFY` | `false` | Verify AI Bridge's TLS certificate. Applies only when `graphql_url` uses `https`; the default URL is `http`. |
| `AIB_CA_BUNDLE` | empty | CA certificate path inside the backend container, when `AIB_TLS_VERIFY=true`. |
| `AIB_APP_HOSTNAME` | — | This VAP host's name or address, as the XProtect host reaches it. Used to build `dashboard_url`. |
| `UI_HTTPS_PORT` | `3443` | VAP dashboard port. |
| `LOITERING_THRESHOLD_SEC` | `5.0` | Seconds in the zone before a person counts as loitering. Keep equal to the recipe's value. |

### `vendor_options` of the Milestone instance

| Key | Default | Description |
| --- | --- | --- |
| `graphql_url` | `<base_url>/api/bridge/graphql` | AI Bridge GraphQL endpoint. |
| `dashboard_url` | required | VAP dashboard URL that Management Client shows as the app's page. It must open from the XProtect host. `app_base_url` is accepted as an old alias. |
| `vms_id` | all attached systems | Register with only this XProtect system. |
| `app_ids` | derived | App id → GUID map, for example `{dls_vision: <guid>}`. See [App GUIDs](#app-guids). |
| `metadata_format` | `ONVIF_ANALYTICS_FRAME` | Metadata format for `object_detection` apps: `ONVIF_ANALYTICS_FRAME` or `ONVIF_ANALYTICS`. `DEEPSTREAM_MINIMAL` is accepted at registration, but VAP cannot produce it, so every frame fails with `milestone_metadata_translation_failed`. |
| `class_map` | built in | Category → ONVIF object class, overriding the defaults (`person`, `pedestrian`, `human` → `Human`; `vehicle` → `Vehicle`). Other categories are sent as they are. |
| `event_min_interval_s` | `0` (no limit) | Minimum seconds between analytics events for the same person on the same camera (for captions, per camera). The shipped `config.yaml` sets `10`. |
| `app_version`, `manufacturer_name` | `1.0`, `Intel Corporation` | Shown in Management Client. |
| `manifest_path` | bundled | Hand-written AI Bridge manifest. Used only by the register endpoint when no configured app maps to a topic; startup registration skips registering instead. |

### Loitering Detection app settings

These keys of the `object_detection` entry in `analytics_apps` matter for XProtect:

| Key | Description |
| --- | --- |
| `app_id`, `display_name` | `display_name` is the app's name in Management Client. `app_id` prefixes its topic names. Changing `app_id` changes the app GUID. |
| `pipeline.cpu/gpu/npu` | DLSPS pipeline for each device. At least one is required. |
| `label_map` | Detector label → category. The Milestone instance maps the category to an ONVIF class. |
| `default_zone_polygon` | Zone sent to the pipeline when a run starts without one, as normalized `[x, y]` points. |
| `zones` | Boxes drawn on the video, with a `label` and a normalized `bounding_box`. Keep equal to the measured zone. |
| `loitering_threshold_s` | Threshold sent to the pipeline (on-video text color). |
| `events_enabled` | Send loitering rows as analytics events. |
| `event_topic_suffix` | MQTT topic suffix of the loitering rows. Must match the recipe's `DEST_TOPIC_SUFFIX`. |
| `metadata_topic_prefix` | MQTT topic prefix. Must match the recipe's `SOURCE_TOPIC_PREFIX`. |

## How it works

### Connection and camera discovery

On startup VAP asks AI Bridge for the XProtect systems attached to it
(`about { videoManagementSystems { id } }`); this is also its reachability check. It then
lists the cameras with `cameras { videoStreams { ... } }`.

AI Bridge addresses video by device and stream, so VAP camera ids are
`milestone:<deviceId>/<streamId>`. AI Bridge returns a ready RTSP address and, when
XProtect knows it, the stream's resolution. A stream without an RTSP address is
reported as offline.

### App registration

VAP registers each app in `analytics_apps` as its own IVA app, with every attached
XProtect system (or only `vms_id`). The app's `type` sets its topics:

| App `type` | Topics | Format |
| --- | --- | --- |
| `object_detection` | `<app_id>-metadata`, `<app_id>-events` | `metadata_format`, `ANALYTICS_EVENT` |
| `live_captioning` | `<app_id>-events` | `ANALYTICS_EVENT` |

An app whose type has no mapping is skipped and logged as
`milestone_unmapped_analytics_app_type`. VAP never registers video topics: each would
use one XProtect device license per stream.

To register again without restarting, for example after editing `config.yaml`:

```bash
curl -k -X POST https://localhost:3443/v1/vms/milestone/register \
  -H 'Content-Type: application/json' -d '{}'
```

`milestone` in the path is the instance `name` in `config.yaml`. If `VMS_PLUGIN_API_KEY`
is set, add `-H 'X-API-Key: <key>'`.

Restart the XProtect Event Server afterwards (see
[Events and Alarms, Step 4](./events-and-alarms.md#step-4-view-alarms-in-smart-client)).

### App GUIDs

AI Bridge identifies an app by GUID. VAP derives it from the VMS instance name and the
app id, so restarting VAP updates the same app instead of adding a duplicate, and two
VAP deployments with different instance names can share one AI Bridge. To adopt an app
registered by something else, pin its GUID:

```yaml
vendor_options:
  app_ids:
    dls_vision: "11111111-2222-3333-4444-555555555555"
```

### Pipeline and MQTT topic

When a run starts, VAP:

1. Looks up the camera's RTSP restream address.
2. Scales the zone to the camera's resolution and sends it as
   `analytics-properties.zones`. Pipelines that declare `roi-properties` also get the
   zone's bounding rectangle as their region of interest, so detection and loitering use
   the same area.
3. Sends the threshold as `loitering-watermark-properties.loitering-threshold`, to
   pipelines that declare it.
4. Asks the pipeline to publish on `<metadata_topic_prefix>/milestone:<deviceId>~<streamId>`.
   The `/` of the camera id becomes `~`, so the topic has a single level after the prefix.

### Metadata and events

For every pipeline frame with detections or configured zones, VAP posts an ONVIF
metadata frame to `<app_id>-metadata`. With `zones` configured, that is every frame, so
the zone stays visible on empty scenes. Without zones, frames with no detections are
skipped. For every loitering row, it posts an
analytics event to `<app_id>-events`; see [Events and Alarms](./events-and-alarms.md).

## Limitations

- **The VAP page in Management Client is not camera-aware yet.** The camera page works
  when opened directly (`https://<vap-host>:3443/<deviceId>/<deviceId>/<streamId>`), but
  the address Management Client opens does not route to it.
- **No XProtect sign-in on VAP pages.** VAP does not validate the operator token that
  AI Bridge sends when it runs with `enforce-oauth=true`. If `VMS_PLUGIN_API_KEY` is
  set, the pages inside Management Client cannot call VAP.
- **No automatic reconnection.** If AI Bridge is unreachable when VAP starts, VAP does
  not retry; restart the backend once AI Bridge is up.
- **Pipelines are not resumed.** If Loitering Detection restarts, start each camera's
  pipeline again.
- **One Milestone instance, named `milestone…`.** Pipeline results are routed to the VMS
  instance whose `name` starts with `milestone`, the vendor prefix in the camera id. Keep
  a single `vendor: milestone` instance and give it a name that starts with `milestone`
  (the default is `milestone`).
- **Event Server restart.** XProtect may not raise alarms for a newly created analytics
  event until the Event Server restarts.
- **Cameras without a resolution.** VAP cannot place the zone on a camera for which
  XProtect reports no resolution, which is common for simulated cameras.
- **Unticked metadata topic.** AI Bridge accepts and drops metadata for a camera whose
  metadata topic is not ticked, without an error.

## Troubleshooting

### VAP and AI Bridge

| Symptom | Cause and fix |
| --- | --- |
| `milestone_connect_failed` | AI Bridge is unreachable, or the GraphQL port is not exposed (production mode uses the proxy). Check `AIB_HOST`, `AIB_GRAPHQL_PORT`, then restart the backend. |
| `milestone_graphql_failed` | The HTTP request to AI Bridge failed (connection refused, timeout, TLS error). The logged `error` says which. |
| `milestone_graphql_errors` | AI Bridge rejected a query. Read the logged `errors`. |
| `milestone_no_vms_attached` | AI Bridge runs but is not attached to XProtect. |
| `milestone_autoregister_failed` with `dashboard_url is required` | Set `AIB_APP_HOSTNAME`, or `vendor_options.dashboard_url`. |
| `milestone_autoregister_skipped` | No app in `analytics_apps` maps to an AI Bridge topic. |
| `milestone_register_failed` | Registration failed for the XProtect system named in the log. |
| No cameras discovered | The AI Bridge user cannot see the cameras. |
| Duplicate apps in Management Client | The app GUID changed: the VMS instance `name`, the app's `app_id`, or its `app_ids` entry changed. Remove the old app in Management Client. |
| App or topics not in Management Client | The Processing Server Admin Plugin is not installed, or Management Client was not restarted. |

### Pipeline and overlays

| Symptom | Cause and fix |
| --- | --- |
| `od_zone_resolution_unavailable` | AI Bridge has no resolution for the camera, so the zone is not sent and the pipeline uses its default zone. Use a camera that reports its resolution. |
| No boxes in Smart Client | Tick `dls_vision-metadata` on the camera's **Processing server** tab. Check that the pipeline runs (`/v1/analytics-apps/dls_vision/runs`). |
| Boxes for everyone, but no loitering | People are outside the zone. Move `default_zone_polygon` to where people stand, and keep `zones.bounding_box` equal to it. |

### Events and alarms

| Symptom | Cause and fix |
| --- | --- |
| No `loitering_event_published` in VAP's log | Check `events_enabled: true`; that `mqtt-table-flattener` runs and its `DEST_TOPIC_SUFFIX` matches `event_topic_suffix`; and that someone has stayed in the zone longer than the threshold. |
| `result=False` in VAP's log | The event topic is missing in AI Bridge. Restart the backend to register again. |
| AI Bridge logs `succeeded`, but no alarm | Restart the XProtect Event Server. Then check that the alarm definition triggers on **Loitering Detection / dls_vision-events**, includes the camera in its sources, is enabled, and has a time profile that covers now; and that analytics events are enabled with the AI Bridge host allowed. The event name and class do not matter. |
| AI Bridge logs `Invalid analytics event received` | The camera is not known to XProtect, for example after it was removed. Discover the cameras again and restart the pipeline. |
| Too many alarms | Raise `event_min_interval_s`. |
| Alarm has no outline | VAP had not seen the person's box in the 5 seconds before the event (`with_box=False` in the log). |

## References

- [Milestone AI Bridge documentation](https://doc.milestonesys.com/AIB/Help/latest/en-us/)
- [Milestone AI Bridge samples](https://github.com/milestonesys/MIP-AIBridge-samples)
- [AI Bridge container images](https://gallery.ecr.aws/milestonesys/aibridge)
- [Loitering Detection documentation](https://docs.openedgeplatform.intel.com/dev/edge-ai-suites/loitering-detection/index.html)
