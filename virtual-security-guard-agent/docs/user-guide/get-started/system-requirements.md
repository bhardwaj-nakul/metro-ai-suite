<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# System Requirements

VSG itself is light. Most of the compute is in VSS and in the model Hermes
uses; size those from their own documentation.

## Validated Platforms

- **Hardware**: VSS and the model server (OVMS) on Intel® Xeon® or Intel®
  Core™ Ultra Series 3 platforms, or Intel® Arc™ B70 dGPU. The VSG container can run on the
  VSS host or on any host that reaches both Hermes and VSS.
- **Reasoning model**: an OpenVINO™ model on OVMS that returns tool calls. The
  GPU (for an integrated GPU, system memory) needs room for the weights, the
  KV cache, and any VSS models on the same host.
- **Operating system**: Ubuntu 24.04 LTS.

## VSG Container

| Resource | Value |
|---|---|
| CPU | 1 core (Compose limit) |
| Memory | 256 MB (Compose limit) |
| Disk | About 120 MB for the image; allow 1 GB to build it locally. |

## Model Host (Hermes and OVMS)

The reasoning model is the largest resource that the VSG agent needs. These values are
the minimum for the default model, `OpenVINO/Qwen3.6-35B-A3B-int4-ov`, and they
are a starting point, not a performance/accuracy guarantee.

| Resource | Minimum |
|---|---|
| Processor | Intel® Core™ Ultra 3 processor with an integrated GPU. Validated on Panther Lake (PTL 358H). The integrated GPU uses system RAM. |
| Memory | 64 GB RAM. The weights, the KV cache, and any VSS models on the same host share it. |
| Disk | 128 GB free, for the model weights and the Hugging Face cache. |

- The model on an integrated GPU answers more slowly than a hosted model.
  Expect each reply to take from several seconds to a few minutes. The first
  request after a restart is the slowest, because the model loads and the
  prompt is processed.
- Smaller models, for example a 9B model, reply faster but more often ignore
  the reply format or call tools wrongly. Use one to try the VSG agent, not for
  investigations that matter.
- Larger dense models need more memory and are slow on a CPU or an
  integrated GPU. Run one only on a host with enough memory and, ideally, a
  GPU with enough dedicated memory.
- Other hardware is untested. Check the reply speed on your host before you
  rely on it.

## Software

- Docker Engine with the Compose and Buildx plugins:
  [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
  Building the UI image needs BuildKit, which Compose uses only when Buildx is
  installed. Check with `docker buildx version`.
- GNU Make: `sudo apt-get install -y make`.
- A VSS deployment with search enabled, the VSS MCP server, and indexed
  footage.
- A Hermes agent server with the API server enabled and the VSS MCP server
  registered.
  [Set Up the Prerequisite Stack](./set-up-prerequisite-stack.md) sets up
  VSS, then Hermes, OVMS and the Inference Router with agent-harness-install.

## Network Ports

| Port | Service | Reached by |
|---|---|---|
| `12346` | VSG console (`VSG_UI_PORT`) | The browser (the only port it needs). |
| `8642` | Hermes API server | The VSG container. |
| `12345` | VSS nginx gateway, including the VSS MCP server at `/mcp` | The VSG container and Hermes. |
| `8010` | Inference Router, on the `<HOST_IP>` given to the installer | Hermes, on the same host. |
| `8450` (`HARNESS_OVMS_REST_PORT`) | OVMS, on the `<HOST_IP>` given to the installer | The Inference Router. |
