# Release Notes: Visual Search and QA

## Version 2026.3.0

**Helm Chart Version**: 1.1.0
**Release Date**: October 9, 2026

**Changes**:

- Data Preparation:

  - Replaced the Milvus-specific data preparation microservice with the generic
    Multimodal DataPrep microservice, which is shared with other applications.
  - Media is embedded in place from the shared data mount, so ingesting a
    directory no longer stores a second copy of the media on disk.
  - Re-running an update against the same directory now skips already ingested
    files instead of duplicating them.
  - Object detection is disabled by default. Only full frames are indexed, which
    keeps search results free of crop duplicates. Set
    `MM_DATAPREP_ENABLE_OBJECT_DETECTION` and `DATA_INGEST_WITH_DETECT` to
    enable it.
  - Object detection now uses Hugging Face OpenVINO models. Set
    `DATAPREP_DETECTION_MODEL` (Helm `MM_DATAPREP_DETECTION_MODEL_NAME`) to an
    `OpenVINO/<repo>` object-detection model such as `OpenVINO/yolox_s-int8-ov`.
    It has no default and is required whenever object detection is enabled. The
    optional `DATAPREP_DETECTION_CLASSES` keeps only the listed classes.
    Downloaded models are cached in the `dataprep-detection-models` volume; the
    former `dataprep-yolox-models` volume is no longer used and can be removed.
  - Added `DATAPREP_PIPELINE_STALL_TIMEOUT_S` (default 300s), which fails an
    ingest job whose pipeline stops making progress instead of leaving it
    running indefinitely. Set it to 0 to disable the watchdog.

- Helm Chart:

  - The chart is no longer tied to a namespace named `vsqa`. In-cluster service
    addresses are derived from the release namespace, so it can be installed
    into any namespace.
  - Added `resources` on the VLM, embedding, and data preparation services to
    request Intel device plugin resources when running on GPU or NPU.
  - The render device group is now applied to the pods, so a non-root container
    user can open `/dev/dri/renderD*`.
  - Added `global.nodeSelector` to pin the pods to the node that holds the
    host data path and the accelerator devices.

- Documentation:

  - Documented device selection, device plugin resources, device group ids,
    node pinning, and the corresponding troubleshooting steps for Helm.
  - VLM OpenVINO Serving is now consumed as a published image instead of being
    built from source.

**Hardware Used for Validation**:

- Intel® Core™ processors (13th Gen, i7 recommended)
- Intel® Arc™ A-Series Graphics (Intel® Arc™ A770 recommended)

## Version 2025.2.0

**Helm Chart Version**: 1.0.0
**Release Date**: December 10, 2025

**Features**:

- Visual Search:

  - Search images and videos using natural language queries.

- Question Answering:

  - Ask questions about selected media and receive context-aware answers.

- Microservices Architecture:

  - Includes data preparation, retriever, multimodal embedding, VLM serving, and a Streamlit-based web UI.

**Hardware Used for Validation**:

- Intel® Core™ processors (13th Gen, i7 recommended)
- Intel® Arc™ A-Series Graphics (Intel® Arc™ A770 recommended)
