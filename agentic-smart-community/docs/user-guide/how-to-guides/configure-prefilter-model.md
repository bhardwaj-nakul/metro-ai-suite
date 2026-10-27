# Configure the Prefilter Model for a Monitor

The *prefilter* is a lightweight detection model that runs on every motion clip before the clip reaches the video-summary service. Clips that contain none of the target objects are dropped, so the VLM only ever sees footage worth describing. That saves inference cost and cuts false positives.

Every monitor picks its own prefilter model, so a child-safety camera and a parking-lot camera can run different detectors, on different devices, at the same time. This guide shows how to add a model to the deployment and point a monitor at it.

By the end of this guide you will know how to:

- prepare an OpenVINO™ IR model the prefilter can use;
- register it so it becomes selectable;
- discover which models are available and what classes each one detects;
- point one monitor — or several, each at a different model — at the model you want;
- read the diagnostics when a model does not show up.

**Prerequisites:** the stack is running (see the [Get Started Guide](../get-started.md)), and you can edit the `videostream-analytics` configuration. The live configuration is `${VIDEOSTREAM_CACHE_HOST}/config.yaml` (default `~/.cache/.videostream-analytics/config.yaml`) — regenerated from `videostream-analytics/config/config.yaml.example` on every deploy, with the previous copy kept as `config.yaml.<YYYYMMDD-HHMMSS>.bak` — also reachable through the `videostream-analytics/config/config.yaml` symlink in the repo. Models you want to keep across deploys belong in the **template** (`config.yaml.example`); see Step 2.

## When to change the prefilter model

The bundled YOLO11s detector covers the COCO-80 classes and suits most scenes. Change it when:

- **Your target class is not in COCO-80.** Safety helmets, license plates, forklifts, and livestock breeds all need a model trained for them.
- **You want a different speed/accuracy balance.** A smaller model (YOLO11n) raises throughput on a busy camera; a larger one (YOLO11m/l) catches smaller or partly hidden objects.
- **You want a different inference device for one camera.** The model and the device are independent per-monitor settings, so one camera can run on the NPU while another runs the same or a different model on the GPU.

Prefilter is optional. When any motion is worth reviewing, leave `prefilter.enabled=false` and skip this guide.

## How a monitor picks its model

Models are **registered in configuration, then selected by name**:

```text
config.yaml                        monitors.yaml  /  register_source
┌───────────────────────────┐      ┌──────────────────────────────┐
│ prefilter_models:         │      │ pipeline_config:             │
│   yolo11s:        ◀───────┼──────┼──  prefilter:                │
│     kind: detection       │ name │      model: yolo11s          │
│     model_path: …/…xml    │      │      target_classes: [...]   │
│   helmet_v2:              │      │      device: NPU             │
│     kind: detection       │      └──────────────────────────────┘
│     model_path: …/…xml    │
└───────────────────────────┘
```

Two consequences are worth knowing up front:

- **Only registered models are selectable.** A monitor cannot point at a file path; it names an entry from `prefilter_models`. A request that carries a raw `model_path` is rejected with HTTP 422.
- **Registration alone is not enough.** Each entry is validated, and only entries that pass are offered as choices. An entry that names a missing file, a half-copied IR pair, or a model whose output is not a detection tensor is reported as unavailable with the reason — it never silently becomes a monitor's model.

## Step 1 — Prepare the model

The prefilter runs models in the OpenVINO™ IR format: a `.xml` graph plus a `.bin` weights file with the same stem, side by side.

Put the pair anywhere under `PREFILTER_MODEL_DIR` (default `~/models/openvino`). Organize subdirectories however you like — the only requirement is that the files are under that root, because Docker Compose bind-mounts exactly that directory read-only into the container. A model outside it is unreadable at runtime no matter how valid its host path looks.

```text
~/models/openvino/
├── yolo11s/FP16/yolo11s.xml     # the bundled model
│              /yolo11s.bin
└── helmet-v2/helmet_v2.xml      # your own layout is fine
             helmet_v2.bin
```

To convert an Ultralytics YOLO checkpoint, the repository ships a converter:

```bash
python3 videostream-analytics/scripts/helpers/convert_yolo_ov.py \
  --weights ~/weights/helmet_v2.pt \
  --precision FP16 \
  --xml-path ~/models/openvino/helmet-v2/helmet_v2.xml \
  --bin-path ~/models/openvino/helmet-v2/helmet_v2.bin \
  --dynamic False --imgsz 704 1280
```

> [!IMPORTANT]
> **Export a static input shape for NPU.** The OpenVINO™ NPU plugin requires fixed input dimensions — `--dynamic False --imgsz <h> <w>`, as above. A dynamically-shaped model fails to compile on the NPU; run it on `CPU` or `GPU` instead, or re-export it with a fixed size.

Class names should be embedded in the model's `rt_info`, which the Ultralytics export does automatically. Without them, the platform falls back to guessing COCO-80 and tells you the names are not authoritative.

## Step 2 — Register the model

Add an entry under `prefilter_models` in `videostream-analytics/config/config.yaml.example`, then deploy (`bash videostream-analytics/setup_vsa.sh` or `./setup_docker.sh`).
Every deploy regenerates the live configuration from that template, so the template is where an entry survives.
To try a model first, add it to the live file instead (`videostream-analytics/config/config.yaml`, a symlink to `${VIDEOSTREAM_CACHE_HOST}/config.yaml`) — it applies immediately but is replaced at the next deploy, when the previous copy is saved as `config.yaml.<YYYYMMDD-HHMMSS>.bak` beside it:

```yaml
prefilter_models:
  yolo11s:
    kind: detection
    backend: openvino
    model_path: "${PREFILTER_MODEL_DIR}/yolo11s/FP16/yolo11s.xml"
    description: "YOLO11s FP16, static 1280x704 input, COCO-80 classes"

  helmet_v2:
    kind: detection
    model_path: "${PREFILTER_MODEL_DIR}/helmet-v2/helmet_v2.xml"
    description: "Safety-helmet detector, FP16, static 1280x704"
```

| Field | Required | Description |
| ----- | -------- | ----------- |
| *(key)* | ✅ | The name monitors use — `prefilter.model: helmet_v2`. |
| `kind` | ✅ | What the model does. Supported: `detection`. |
| `backend` | | Runtime that executes it. Case-insensitive, default `openvino`. Supported: `openvino`. |
| `model_path` | ✅ | Absolute path to the IR `.xml`, under `PREFILTER_MODEL_DIR`. `${PREFILTER_MODEL_DIR}`, `${HOME}` and `~` are expanded. |
| `description` | | Free text, shown to agents helping a user choose a model. |

`kind` and `backend` each accept one value today. They are validated rather than assumed so that adding a second model type or a second runtime later needs no change to how your monitors are configured.

The service watches the file and applies edits automatically within a couple of seconds — running monitors keep streaming. To apply immediately (or to confirm from the response), reload explicitly:

```bash
curl -X POST localhost:8999/config/reload
```

Or ask the agent: *"reload the analytics configuration"* (it runs `smart_community_monitor_ctl action=reload_config`). `GET /capabilities/prefilter` shows the new entry either way. `docker compose restart videostream-analytics` works too; reload just avoids interrupting every running monitor.

### Register by conversation instead of editing the file

Once the model files are under `PREFILTER_MODEL_DIR`, you can also ask the agent to add the entry for you:

> Register the prefilter model `helmet_v2` at `/home/me/models/openvino/helmet-v2/helmet_v2.xml`.

The agent runs `smart_community_monitor_ctl action=register_prefilter_model`, which adds the entry to the same configuration file (comments and the other entries are kept), reloads the service, and reports back whether the model is now selectable or was rejected, with the reason.
It is idempotent for an identical entry and refuses to overwrite an existing entry that differs — edit the file by hand for that.
Like any edit to the live file, the entry lasts until the next deploy; add it to `config.yaml.example` as well to keep it.

If the result is `written_not_listed`, the service is not reading the file the agent just edited.
This usually follows an editor atomic save or `sed -i` on the host config, after which the MCP server's single-file mount still points at the replaced file; restart the MCP server and retry.

## Step 3 — Discover what is available

Ask a connected agent, in conversation:

> Which prefilter models are available?

The agent calls `smart_community_monitor_ctl action=prefilter_options` and reports the list. Pass `model=<name>` to get one entry's detail instead of the whole list.

The same information is available directly:

```bash
curl -s localhost:8999/capabilities/prefilter | jq
```

```json
{
  "enabled": true,
  "default_model": "yolo11s",
  "supported_kinds": ["detection"],
  "supported_backends": ["openvino"],
  "available_devices": ["CPU", "GPU", "NPU"],
  "models": [
    {
      "name": "yolo11s",
      "kind": "detection",
      "backend": "openvino",
      "model_path": "/home/user/models/openvino/yolo11s/FP16/yolo11s.xml",
      "description": "YOLO11s FP16, static 1280x704 input, COCO-80 classes",
      "class_names": ["person", "bicycle", "car", "..."],
      "labels_source": "embedded",
      "input_shape": "[1,3,704,1280]",
      "output_shape": "[1,84,18480]"
    }
  ],
  "rejected": [
    { "name": "helmet_v2", "model_path": "...", "reason": "cannot read ...helmet_v2.bin: No such file or directory" }
  ]
}
```

Read it as follows:

- **`models`** — the selectable set. Only these names are accepted as `prefilter.model`.
- **`rejected`** — registered entries that cannot be used, each with the reason. Diagnostics only; these names are not selectable.
- **`class_names`** — what `target_classes` may contain, qualified by `labels_source`:
  - `embedded` — authoritative, read from the model itself. A class outside this list is rejected with HTTP 422 at registration.
  - `fallback_coco` — the model embeds no labels, so this is a COCO-80 **guess**. Confirm the names against how the model was trained.
  - `unavailable` — labels could not be read at all.
- **`input_shape`** — `[1,3,704,1280]` is static and NPU-capable; a `?` in the spatial dimensions means dynamic, so pick `CPU` or `GPU` for that model.
- **`available_devices`** — what this host's OpenVINO™ installation can target.

## Step 4 — Point a monitor at the model

In `monitors.yaml`, set `model` inside the monitor's prefilter block. Each monitor is independent — model, classes, and device can all differ:

```yaml
monitors:
  cam_child:
    enabled: true
    name: "Child Safety Camera"
    source_url: rtsp://localhost:8554/live/child
    use_case: child_safety
    pipeline_config:
      motion: { enabled: true, diff_threshold: 25, area_ratio: 0.015, stable_frames: 30 }
      prefilter:
        enabled: true
        model: yolo11s
        target_classes: [person, knife, scissors, bottle]
        min_confidence: 0.4
        device: NPU
      recording: { enabled: true, interval_seconds: 60 }

  cam_site_gate:
    enabled: true
    name: "Construction Site Gate"
    source_url: rtsp://localhost:8554/live/gate
    use_case: helmet_compliance
    pipeline_config:
      motion: { enabled: true }
      prefilter:
        enabled: true
        model: helmet_v2          # different model…
        target_classes: [helmet, head]
        device: GPU               # …and a different device
      recording: { enabled: true, interval_seconds: 60 }
```

Restart the MCP server to apply `monitors.yaml`, or do it conversationally without a restart:

> Register `cam_site_gate` on `rtsp://localhost:8554/live/gate` for the `helmet_compliance` use case, with the `helmet_v2` prefilter model and target classes helmet and head.

The agent runs `smart_community_monitor_ctl action=register_source` with the matching `pipeline_config`, and with `persist=true` mirrors the entry back into `monitors.yaml`.

A monitor that omits `model` inherits `defaults.prefilter.model` from `config.yaml`.

## Step 5 — Verify

Check that the monitor loaded the model you expect:

```bash
docker compose -f videostream-analytics/docker/docker-compose.yaml logs videostream-analytics \
  | grep -E "Loading OpenVINO model|Prefilter enabled"
```

```text
[cam_child]     Loading OpenVINO model: /home/user/models/openvino/yolo11s/FP16/yolo11s.xml (device=NPU)
[cam_child]     Prefilter enabled: classes=['person', 'knife', 'scissors', 'bottle']
[cam_site_gate] Loading OpenVINO model: /home/user/models/helmet-v2/helmet_v2.xml (device=GPU)
[cam_site_gate] Prefilter enabled: classes=['helmet', 'head']
```

Once motion arrives, each clip logs its verdict (`Prefilter PASS: hits=3 classes=['helmet'] …` or `Prefilter SKIP: …`), and the hits are recorded per event. Ask the agent *"show the recent events for cam_site_gate"*, or query directly:

```sql
-- via smart_community_video_db
SELECT start_time, prefilter_classes, prefilter_confidence
FROM events WHERE monitor_id = 'cam_site_gate'
ORDER BY start_time DESC LIMIT 10;
```

If `prefilter_classes` is consistently empty while you expect detections, lower `min_confidence`, confirm the class names against `class_names`, or check that the camera's resolution suits the model's input size.

## Troubleshooting

**The model is not in `models`.** Find it in `rejected` — the reason names the problem:

| Reason | Fix |
| ------ | --- |
| `kind '<x>' is not supported` | Only `detection` works today. |
| `backend '<x>' is not supported` | Only `openvino` works today. Remove the field to take the default. |
| `is not under PREFILTER_MODEL_DIR (...)` | Move the model under `PREFILTER_MODEL_DIR` (default `~/models/openvino`), or set that environment variable to where it already lives and redeploy. The container only mounts that one root. |
| `cannot read <path>.bin` / `is empty` | The IR pair is incomplete. Copy both `.xml` and `.bin`, and check they are not truncated. |
| `backend 'openvino' expects an IR .xml` | Convert the model to OpenVINO™ IR first. |
| `openvino could not read <path>` | The file is not a valid IR — re-export it. |
| `not a usable detection model: ...` | The output tensor is not `[1, 4+nc, anchors]`. The model is probably a classifier or a pose model, or `nc` disagrees with the number of embedded labels. |

**`422 unknown target_classes`.** The class is not in the model's embedded label set; the error echoes the valid `class_names`. This check only fires when `labels_source` is `embedded` — an untrusted label list is never used to reject your request.

**`422 model_path is not accepted`.** Models are selected from the registry, not by path. Register the model in your live configuration and reference it as `prefilter.model: <name>`.

**You edited the file but nothing changed.** Two common causes: you edited the tracked template `config/config.yaml.example`, which no running instance reads until the next deploy regenerates the live file from it — run `setup_vsa.sh`, or edit the live file for an immediate (temporary) effect; or the service has not been restarted since the edit.

**Your edits to the live file disappeared.** The deploy regenerated it from `config.yaml.example`. The previous copy is the newest `${VIDEOSTREAM_CACHE_HOST}/config.yaml.<YYYYMMDD-HHMMSS>.bak`; copy what you want back into `config.yaml.example` so it survives the next deploy. The startup log line `Loaded configuration from <path>` names the file the service actually read.

**`422 model_not_available`.** The name is not registered, or it is registered but did not validate. The error lists the names that *are* selectable; `GET /capabilities/prefilter` explains why the others are not.

**The NPU fails to compile the model.** The NPU plugin needs a static input shape. Confirm `input_shape` has no `?`, re-export with `--dynamic False --imgsz <h> <w>`, or switch that monitor to `device: CPU` / `device: GPU`.

**ROI stopped working.** ROI crops are driven by prefilter hits, so ROI silently no-ops when prefilter is disabled or never passes. Keep `prefilter.enabled=true` alongside `roi.enabled=true`.

## Related

- [MCP Tools Guide](./mcp-tools.md) — `smart_community_monitor_ctl` parameters and return shapes.
- [Register a New Use Case](./register-new-use-case.md) — the conversational flow that configures prefilter and ROI for a new monitor.
- [Videostream Analytics API](../api-reference/api-reference-videostream-analytics.md) — `GET /capabilities/prefilter` and the `PrefilterConfig` schema.
