<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Release Notes: Virtual Security Guard Agent

## Version 2026.3.0

Virtual Security Guard Agent is a new sample application: A security agent that searches recorded and live camera footage through Intel® Video Search and Summarization (VSS).

**New**:

- Chat-driven investigations with text and image search through the VSS MCP server.
- Human-in-the-loop review grid: top six matches, up to 20 per search, confirm-only; the latest grid stays editable.
- Clip player with **Pause & crop person** and automatic follow-up image search.
- Time-ordered route of confirmed sightings on an uploadable floorplan whose camera keys are the VSS tags.
- Optional, operator-started live camera search with time and quiet limits.
- Editable incident reports drafted by the VSG agent and exported as PDF in the browser.
- Live camera management backed by VSS streams.
- Results grounded in real VSS tool output from the Hermes transcript.
- Single read-only, non-root nginx container with an allowlist proxy; the
  Hermes API key never reaches the browser.
- Hermes skills `virtual-security-guard` and `vsg-incident-report`.

**Known Issues**:

- No user authentication; deploy on a trusted network.
- See [Known Issues](./known-issues.md).
