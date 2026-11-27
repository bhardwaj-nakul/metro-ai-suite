# Release Notes: Live Video Search

## Version 2026.3.0

**Release Date**: December 7, 2026

**New**:

- Added the `--pull-always` option to `setup.sh` (`PULL_ALWAYS=true` for `make deploy`) to refresh cached images from the registry before starting the stack.
- Multimodal DataPrep object detection now uses Hugging Face `OpenVINO/*` detection models instead of the bundled YOLOX download. Select the model with `DATAPREP_DETECTION_MODEL` in Compose, `setup.sh`, or the Makefile. The model is downloaded on first start and cached in the `dataprep-detection-models` volume.
- Added `DATAPREP_DETECTION_CLASSES` to keep only selected classes from the detection model's label set.
- Exposed the DataPrep pipeline stall watchdog through `MM_DATAPREP_PIPELINE_STALL_TIMEOUT_S`. The default is `300`, and `0` disables the watchdog.

**Improved**:

- Aligned Live Video Search (LVS) with the Video Search and Summarization 2026.3.0-rc2 stack (Multimodal DataPrep, Vector Retriever, and Multimodal Embedding Serving), including the updated GPU drivers in the DataPrep and Multimodal Embedding Serving images.
- `setup.sh` and `make validate-env` now fail early with a clear message when object detection is enabled and no detection model is set.
- Updated the documentation links to the new Metro AI Suite repository.

**Upgrade Notes**:

- **Breaking change:** `DATAPREP_DETECTION_MODEL` is required while object detection is enabled. There is no default model. For example, set it to `OpenVINO/yolox_s-int8-ov`, or set `ENABLE_OBJECT_DETECTION=false` to embed whole frames.
- Each detection model has its own license (for example, `OpenVINO/yolox_*` models use Apache-2.0 and `OpenVINO/YOLO11*` models use AGPL-3.0). Review the model card before use.
- The legacy `docker_dataprep-yolox-models` volume is no longer used. Running `source setup.sh --clean-data` removes it.

## Version 2026.2.0

**Release Date**: September 10, 2026

**New**:

- Replaced the legacy `vdms-dataprep` orchestration with backend-neutral `multimodal-dataprep` in Docker Compose.
- Added an always-on Vector Retriever layer so Video Search no longer accesses a vector database directly.
- Added selectable VDMS (default) and Milvus backends through `VECTORDB_BACKEND` for Compose.
- Added pinned standalone Milvus/etcd orchestration and updated build, architecture, device, and deployment guidance for both retriever flavors.
- Replaced the collector/Pipeline Manager WebSocket telemetry path with Metrics Manager for Docker Compose, gated by `ENABLE_METRICS_MANAGER` (default `true`) in `setup.sh` and the Makefile. Multimodal DataPrep publishes throughput metrics directly and the UI consumes the same-origin SSE stream through NGINX.
- Added NPU-capable device orchestration for the VSS search stack used by LVS in Docker Compose setup.
- Exposed asynchronous watcher-batch size, polling interval, and timeout settings for Search MS and Smart NVR continuous ingestion through Compose and `setup.sh`.

**Improved**:

- Updated LVS compose deployment to a pure per-component device model (`DATAPREP_EMBEDDING_DEVICE`, `DATAPREP_DETECTION_DEVICE`, `MME_EMBEDDING_DEVICE`; each defaults to `CPU`) and mounted `/dev/accel` for NPU execution. Retired the redundant `VDMS_DATAPREP_DEVICE` baseline.
- Removed the ambiguous `ENABLE_EMBEDDING_GPU` shortcut; indexing and query embedding devices are configured independently with `DATAPREP_EMBEDDING_DEVICE` and `MME_EMBEDDING_DEVICE`.
- Renamed the Compose/setup model input from `EMBEDDING_MODEL_NAME` to `MULTIMODAL_EMBEDDING_MODEL`, the DataPrep variables from `VDMS_DATAPREP_*` to `MM_DATAPREP_*`, and `VDMS_PIPELINE_MANAGER_UPLOAD` to `VIDEO_UPLOAD_ENDPOINT`.
- Vector Retriever now waits for a healthy Multimodal Embedding service before starting.
- Multimodal DataPrep waits for Metrics Manager readiness when metrics are enabled.
- Made Search MS batch-status polling resilient through `SEARCH_DATAPREP_POLL_MAX_RETRIES`, `SEARCH_DATAPREP_POLL_TIMEOUT_MS`, and `SEARCH_DATAPREP_POLL_RETRY_DELAY_MS`.
- Removed the obsolete telemetry Compose overlay and Telegraf configuration.
- Updated LVS documentation (`get-started`, `how-it-works`) with NPU usage guidance, accelerator configuration examples, and Metrics Manager deployment notes.

**Fixed**:

- Fixed Docker Compose backend selection so Milvus deployments do not start or depend on the VDMS service, and stale backend containers are removed when switching backends.
- Fixed the `nvr-event-router` container healthcheck, which now bypasses proxy settings instead of relying on `curl`.
- Miscellaneous documentation corrections.

## Version 2026.1.0

**Release Date:** June 17, 2026

**Known Issues**:

- First‑time model downloads may take several minutes.
- Time‑range queries require the clock and timezone on the host to be accurate.

## Version 1.0.0

**Release Date**: April 1, 2026

Live Video Search is a new sample application which implements embedding and
visual data ingestion microservices (available in
[Edge AI Libraries](https://docs.openedgeplatform.intel.com/2026.0/ai-libraries.html))
for processing RTSP camera streams and user query-based search. The application
converts the input camera data to embeddings continuously, using models like Clip.
The embeddings are stored in a Vector Database (VectorDB ) and enable search on
live camera feed and historical video data.
A rich UI is provided to configure the camera used for data ingestion, enter
the search query, and view telemetry data, currently, for CPU, GPU, and memory
utilization. The sample application introduces camera streaming with Frigate.

**New**:

- Live Video Search stack integrating Smart NVR with VSS Search.
- Time‑range filtering in search via UI or natural‑language query parsing.
- Telemetry visualization in VSS UI for live system performance.

**Known Issues/Limitations**:

- First‑time model downloads may take several minutes.
- Time‑range queries require the clock and timezone on the host to be accurate.

> *The application has been validated on Intel® Xeon® 5 + Intel® Arc&trade; B580 GPU.*
