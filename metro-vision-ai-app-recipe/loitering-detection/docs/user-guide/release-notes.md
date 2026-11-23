# Release Notes: Loitering Detection

## Version 1.7.0

**Release Date**: December 7, 2026

**New**:

- Zone presence and dwell time are now computed natively in the pipeline by the `gvaanalytics`
  element, with the `loitering_watermark` element rendering the dwell-time and status
  overlay. No external low-code flow engine is required.
- Added a lightweight `mqtt-table-flattener` sidecar that reshapes per-frame MQTT metadata into
  one-row-per-object summaries so that the Grafana status table renders correctly.
- Zones are now defined per stream as JSON polygon or circle configurations, so adding or editing
  zones requires no pipeline or dashboard changes.
- Added a QR code to the Grafana dashboard that links to the documentation.
- Added support for Ubuntu 26.04 LTS.
- Added a new console UI application flow.
- Added documentation that showcases the value of NPU acceleration.

**Improved**:

- Removed the Node-RED service and flow. Its zone and dwell-time logic and Grafana data reshaping
  are now handled natively, as described above.
- Removed Helm deployment.
- Consolidated the per-stream tables of the Grafana dashboard into a single status table.
- Improved the hardware telemetry details shown in the system performance panel of the Grafana dashboard.
- Improved the stability and robustness of the script that calculates stream density.
- Updated DL Streamer to version 2026.3.0.

## Version 1.6.0

**Release Date**: September 10, 2026

**New**:

- Fixed coturn server configuration for WebRTC relay.
- Fixed Grafana MQTT datasource version to avoid errors with the latest version.

**Improved**:

- Improved the security context of Grafana and Node-RED containers.
- Consumed the latest DL Streamer version 2026.2.0.

## Version 1.5.0

**New**:

- Qualified on the Intel® Core™ Series 3 processor "Wildcat Lake" (WCL).
- Deprecated EMF deployment packages.

**Improved**:

- Optimized the latency for GPU and NPU workloads.

## Version 1.4.0

**New**:

- Qualified on the Intel® Core™ Ultra Series 3 processor.

**Improved**:

- Consumed the latest DL Streamer Pipeline Server 2026.0.0 image. Ubuntu24 variant of the image is the default now.
- Optimized the latency for GPU and NPU workloads.

## Version 1.3.0

**New**:

- Consumed latest DL Streamer Pipeline Server version 2025.2
- Introduced nginx server as reverse proxy and TLS
- Optimized pipelines and quantized model from FP32 to FP16.

For more details on the new features and improvements, refer to the [overview](./index.md).

## Version 1.2

**Release Date**: March 28, 2025

**Features**:

- **Enhanced Object Detection Models:** Improved accuracy and performance of pre-trained deep
learning models for object detection and classification.
- **Advanced Analytics Dashboard:** Grafana dashboards with additional metrics and
visualizations for better monitoring and analysis.
- **Customizable Alerting System:** Integration with Node-RED for setting up custom alerts and
notifications based on specific events and thresholds.
- **Expanded Device Support:** Added compatibility with a wider range of cameras and video
input devices.
- **Optimized Edge Processing:** Performance enhancements for real-time video processing on
edge devices, reducing latency and resource usage.
