# Release Notes: VMS Adapter Plugin

## Version 2026.3

**Release Date**: December 7, 2026

**New**:

- **Milestone XProtect integration**: Connect VAP to Milestone XProtect through Milestone AI
  Bridge. VAP registers Loitering Detection as an IVA app, discovers XProtect cameras, and posts
  detection boxes and the loitering zone as ONVIF metadata, shown on live and recorded video in
  Smart Client.

- **Configuration setup script**: `setup.sh` generates `config/config.yaml` for the selected VMS
  and analytics apps, for example, `./setup.sh --vms milestone --apps ld`. Each VMS and app keeps its
  settings in a `vap-config.yaml` file in its shim directory.

- **Loitering Detection updates**:
  - Updated to the new Loitering Detection pipeline.
  - Introduced `event_min_interval_s` to limit how often events are sent for the same person.
  - Made the loitering zone and threshold configurable. Set the loitering zone per camera from
    the Nx Witness camera settings or the VAP camera page. VAP scales it to the camera's
    resolution at run start. Set the loitering threshold with `LOITERING_THRESHOLD_SEC`.

**Improved**:

- Breaking Changes:

  - **`config/config.yaml` is now generated and no longer shipped**: Run
    `./setup.sh --vms <vms> --apps <apps>` before `docker compose up`. Without the file, the backend
    exits with `config file not found`. If you customized `config/config.yaml`, move your changes
    into the matching `vap-config.yaml` file, then run `setup.sh` with `--force`; the previous
    file is kept as `config/config.yaml.bak`.

  - **Live Video Captioning MQTT broker moved into the LVC app**: The top-level `mqtt` section of
    `config.yaml` is removed. The broker is now set by `mqtt_host`, `mqtt_port`, and
    `mqtt_tls_*` in the `live_captioning` app entry. The `MQTT_BROKER_*` variables in `.env` are
    unchanged. A `config.yaml` that still has a top-level `mqtt` section loads without error, but
    LVC receives no captions and logs `lvc_mqtt_not_configured_skipping`; regenerate it with
    `setup.sh`.

- **Label mapping**: `label_map` now maps detection labels to vendor-neutral categories. Each VMS
  maps categories to its own types: Nx Witness typeIds (`vap.<category>`, overridable with
  `vendor_options.type_map`) and Milestone ONVIF classes (overridable with
  `vendor_options.class_map`). `label_type_map` is deprecated but still accepted.

- **Event settings**: `event_bookmark_enabled` is deprecated; use `events_enabled`.

- **Loitering Detection defaults**: The default pipelines are `loiter_detect_roi_cpu` and
  `loiter_detect_roi_gpu`, and the Pipeline Server is reached at
  `https://<DLS_VISION_HOST>:443/api`.

**Known Issues**:

- Milestone XProtect:
  - VAP does not reconnect to AI Bridge or resume pipelines after a restart, and the zone cannot be placed on cameras that report no resolution (for example, simulated RTSP cameras).
  - Milestone Event Server might need a restart if Alarms are not triggered even though events are sent.

- Nx Witness: detection overlays do not render in a camera window that was open before the
  pipeline started. Close the window, restart the pipeline, and open the camera again.

**Upgrade Notes**:

- Validated Versions:

  - Milestone XProtect: Professional+ 2026 R1
  - Milestone AI Bridge: 3.0.1, 4.0.0
  - Nx Witness: 6.1.2.42921
  - Live Video Captioning (LVC): 2026.3
  - Loitering Detection: 2026.3

## Version 1.0.0

**Release Date**: September 10, 2026

**New**:

- **Live Video Captioning Integration**: Stream RTSP feeds from any connected camera to the
  Live Video Captioning application (DL Streamer and a VLM). Captions are streamed back to the
  operator dashboard via SSE and overlaid on the WebRTC video player.

- **Loitering Detection Integration**: Route camera feeds to Loitering Detection application. Bounding-box detections are translated from DL Streamer GStreamer
  Video Analytics (GVA) JSON format and pushed back to Nx Witness as analytics objects via the
  Nx REST v4 analytics API.

- **Generic Analytics App API**: A single set of REST routes (`/v1/analytics-apps/{app_id}/…`)
  handles all AI analytics integrations with a consistent lifecycle: start, list, stop, and
  stream results.

- **Provider Dashboard**: React 19 with Vite and Tailwind CSS dashboard served by nginx. Includes
  camera discovery and enable/disable controls, analytics run management, WebRTC live stream
  with caption overlay, and analysis results timeline.

**Validated Versions**:

- Nx Witness: 6.1.2.42921
- Live Video Captioning (LVC): 2026.2.0
- Loitering Detection: 1.6.0

**Known Issues**:

- For fresh integration with Loitering Detection application, the bounding boxes may not render. A workaround is available.

- If the Nx Witness analytics integration is reused from a previous database record (not
  freshly registered), the integration user password is not available from the Nx API. In this
  case, DL Streamer Vision detections cannot be pushed to Nx until the integration is deleted
  from Nx Witness and the VMS Adapter Plugin is restarted to recreate it.

- Helm deployment is not available in this version.
