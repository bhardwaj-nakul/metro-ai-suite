# Release Notes: Smart Corridor

## Version 2026.3.0

**Release Date**: December 7, 2026

This is the initial release of the Smart Corridor sample application.

**Features**:

- Multi-camera, multi-object vehicle tracking across intersection cameras.
- Scene-based analytics with regions of interest defined on a shared map.
- Traffic flow monitoring with vehicle counts and lane dwell time.
- Vehicle event detection, including vehicle reappearance and wrong-way events.
- Single-node and multi-node (parent and child) deployments.
- Near-real-time publishing of tracking data and analytics through an MQTT broker.
- Pre-built Grafana dashboards for traffic analytics and vehicle events.
- Node-RED and InfluxDB integration for data processing and storage.
- Video ingestion and AI inference with DL Streamer Pipeline Server on Intel® integrated GPU and NPU.
- Secure access over HTTPS through an NGINX reverse proxy, with TLS-secured MQTT between nodes.
