# Release Notes: Smart Intersection

## Version 1.21.0

**New**:

- Added support for Ubuntu 26.04 LTS
- Added a QR code to the Grafana dashboard that links to the documentation.
- Added useful hardware telemetry details in the system performance dashboard panel in Grafana.

**Removed**:

- Removed helm deployment.

**Improved**:

- Improved the security context by adding authentication to Node-RED container.
- Stability and robustness improvements in the script that calculates stream density.
- Consumed the latest DL Streamer Pipeline Server version 2026.3.0.
- Consumed the latest Scenescape version 2026.3.0.

## Version 1.20.0

**Release Date**: September 10, 2026

**New**:

- Configurable NGINX upload limit is now available (e.g. for Scenescape GLB 3D base map files).
- GPU and NPU support with Trusted Compute has been integrated.

**Improved**:

- Consumed the latest DL Streamer Pipeline Server version 2026.2.0.
- Consumed the latest Scenescape version 2026.2.0.

## Version 1.19.0

**New**:

- Qualified on the Intel® Core™ Series 3 processor "Wildcat Lake" (WCL).

**Improved**:

- Optimized the latency for GPU and NPU workloads.

## Version 1.18.0

**New**:

- Qualified on the Intel® Core™ Ultra Series 3 processor.

**Improved**:

- Consumed the latest DL Streamer Pipeline Server 2026.0.0 image. Ubuntu24 variant of the image is the default now.
- Consumed the latest Scenescape version 2026.0.0.
- Optimized the latency for GPU and NPU workloads.

## Version 1.17.0

**New**:

- Consumed latest Scenescape version 2025.2
- Consumed latest DL Streamer Pipeline Server version 2025.2
- Introduced nginx server as reverse proxy and TLS
- Enhanced pipeline performance with optimization and GPU acceleration support
