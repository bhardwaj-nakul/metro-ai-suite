# Release Notes: Real-Time Scene Understanding

## Version 2026.3.0

**Release Date**: December 7, 2026

This is the initial release of Real-Time Scene Understanding, a Docker Compose application for prompt-driven analysis of live RTSP camera streams.

**New**:

- RTSP stream ingestion with low-latency browser playback over WebRTC.
- Prompt-based frame alert detection using the `Qwen3-VL-2B-Instruct` VLM, with temporal deep analysis of video segments using `Qwen3-VL-8B-Instruct` by default.
- Dashboard for stream management, live video, alert history, and incident details.
- SeaweedFS-backed storage for analyzed video clips and alert artifacts.
- Live system and inference performance metrics.
- REST APIs for stream lifecycle management, alert retrieval, and frame-registry inspection.

**Known Issues**:

- Helm support is not available in this version.
