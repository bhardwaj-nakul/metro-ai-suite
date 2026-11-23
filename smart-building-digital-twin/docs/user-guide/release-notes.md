# Release Notes: Smart Building Digital Twin

## Version 2026.3.0

**Release Date**: December 7, 2026

This is the initial release of the Smart Building Digital Twin sample application.

**Features**:

- Seven-camera smart-building scene with synchronized, looping RTSP video streams.
- Object detection of people, luggage, and doors with ATSS-MobileNetV2 (default) or
  YOLOX-S model variants.
- Selectable inference device: GPU, CPU, or NPU.
- Replay of badge, FaceID, and ambient-light sensor events synchronized with video loops.
- Detection of security events, including missing credentials, badge switches,
  possible falls, and abandoned, unattended, stolen, or switched luggage.
- Door-state and region-occupancy tracking.
- AI analytics web dashboard with live scene state, rolling scene narration, alerts,
  and camera snapshots.
- System telemetry for CPU, GPU, memory, storage, and CPU SKU.
- Scenescape-based scene management with exportable and restorable scene
  and object-class configuration.
- Support for adding custom scenes.
- Automated deployment with Docker Compose and the `setup.sh` script.
