```{eval-rst}
.. meta::
   :description: Build the Virtual Security Guard Agent container image from source.
   :keywords: Virtual Security Guard Agent, VSG, build, source, Docker, GNU Make
```

<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Build from Source

Run these `make` targets from the `virtual-security-guard-agent` application
directory. `make help` lists the available targets.

## Prerequisites

- GNU Make.
- Docker, for `make build`, `make up`, and `make push`.

## Build the Image

`make build` builds `${REGISTRY}intel/vsg-ui:${TAG}` (default
`intel/vsg-ui:2026.3.0-rc1`) and passes your shell's proxy variables through.

```bash
make build
make up                      # uses the local image

# Custom registry and tag: pass the same values to each target
make build REGISTRY=registry.example.com/ TAG=2026.3.0-rc1
make push  REGISTRY=registry.example.com/ TAG=2026.3.0-rc1
make up    REGISTRY=registry.example.com/ TAG=2026.3.0-rc1
```

`make up` uses a local image before pulling one, so run `make build` after
code changes.

`REGISTRY` needs a trailing slash. `make push` builds before pushing.

For the `lint`, `test`, `check`, and `format` targets, see
[Run Unit Tests](./run-unit-tests.md).