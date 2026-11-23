<!--hide_directive
```{eval-rst}
.. meta::
  :description: Release notes for the Virtual Security Guard Agent.
  :keywords: Virtual Security Guard Agent, release notes, 2026.3.0-rc1.
```
hide_directive-->

<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Release Notes: Virtual Security Guard Agent

## Version 2026.3.0

**Release Date**: December 7, 2026

The Virtual Security Guard (VSG) Agent sample application provides an operator console
for Argus, the agent that searches recorded and live camera footage through Intel's
Video Search and Summarization (VSS) sample application.

**New**:

- Chat-driven investigations with text and image search through the VSS server using the
  Model Context Protocol (MCP).
- Human-in-the-loop review grid that shows the top six matches (up to 20 per search) for
  confirmation only. The latest grid stays editable.
- Clip player with **Pause & crop person** and automatic follow-up image search.
- Time-ordered route of confirmed sightings on an uploadable floorplan. The floorplan’s
  camera keys are the VSS tags.
- Optional, operator-started live camera search with time and quiet limits.
- Editable incident reports drafted by the VSG agent and exported as PDF in the browser.
- Live camera management backed by VSS streams.
- Results grounded in real VSS tool output from the Hermes transcript.
- Single read-only, non-root NGINX container with an allowlist proxy; the
  Hermes API key never reaches the browser.
- Hermes skills `virtual-security-guard` and `vsg-incident-report`.

**Known Issues**:

- The application has no user authentication. Deploy it on a trusted network.
- See [Known Issues](./known-issues.md).
