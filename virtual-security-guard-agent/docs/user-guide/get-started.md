```{eval-rst}
.. meta::
   :description: Set up and run the Virtual Security Guard Agent console.
   :keywords: Virtual Security Guard Agent, VSG, setup, Docker, Hermes, VSS
```

<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Get Started

The **Virtual Security Guard Agent (VSG)** runs as a single container that serves
the console and proxies requests to two upstreams: the **Hermes** agent API and
the Video Search and Summarization (VSS) gateway. The VSG agent runs on the
Hermes agent server. The console has no backend or database of its own.

## Prerequisites

- A host that meets the [System Requirements](./get-started/system-requirements.md),
  with [Docker Engine](https://docs.docker.com/engine/install/) (Compose and Buildx plugins)
  and GNU Make tool (`sudo apt-get install -y make`).
- **VSS** in search mode and a **Hermes** agent server with the VSG agent, set up as
  described in [Set Up the Prerequisite Stack](./get-started/set-up-prerequisite-stack.md).

## Run the Application

### 1. Get the Source

If you have set up the prerequisite stack on this host, you have already cloned the
source for [step 1](./get-started/set-up-prerequisite-stack.md#1-get-the-sources).
Go to the cloned source directory and run `cd metro-ai-suite/virtual-security-guard-agent`.
Otherwise, clone it:

```bash
git clone --filter=blob:none --sparse --branch release-2026.3.0 https://github.com/open-edge-platform/metro-ai-suite.git
cd metro-ai-suite
git sparse-checkout set virtual-security-guard-agent
cd virtual-security-guard-agent
```

All later commands run from this directory.

### 2. Create `deploy/.env`

Set the Hermes API server URL, its key from
[Enable the API server](./get-started/set-up-prerequisite-stack.md#7-enable-the-api-server-and-start-the-gateway),
and the VSS gateway URL. The `make env` command copies `deploy/.env.example` to
`deploy/.env` with these values. If `deploy/.env` already exists, the command
updates these three values and keeps the rest:

```bash
make env HERMES_BASE_URL=http://<hermes-host-ip>:8642 \
         HERMES_API_KEY=<key> \
         VSS_BASE_URL=http://<vss-host>:12345
```

To change other settings, edit `deploy/.env`:

| Variable | Default | Purpose |
|---|---|---|
| `HERMES_BASE_URL` | `http://127.0.0.1:8642` | Hermes API server, `scheme://host:port`, no path. Use the Hermes host's IP: inside the container, `127.0.0.1` is the container itself. |
| `HERMES_API_KEY` | *(required)* | Hermes `API_SERVER_KEY` from `~/.hermes/.env`. NGINX adds it to Hermes requests. |
| `VSS_BASE_URL` | `http://127.0.0.1:12345` | The NGINX gateway address configured by `VSS_BASE_URL (serves `/manager` and `/datastore`). |
| `VSG_FLOORPLAN` | `simple` | Default floorplan: `deploy/floorplans/<name>.json`, mounted into the container. Ships with `simple` (`camera_1`…`camera_4`) and `level4`. See [Configure the Floorplan](./how-to-guides/configure-floorplan.md). |
| `VSG_UI_HOST` | `0.0.0.0` | Set `VSG_UI_HOST` to `127.0.0.1`, to keep the console local. |
| `VSG_UI_PORT` | `12346` | Console port. |
| `TAG` | `2026.3.0-rc1` | VSG UI image tag. |

`REGISTRY` and `TAG` select the image. With `make`, pass them as arguments (see
[Build from Source](./get-started/build-from-source.md)). If `deploy/.env`
already exists, update its `TAG` to `2026.3.0-rc1`; `make env` preserves it.

> [!IMPORTANT]
> `deploy/.env` holds the Hermes API key. Never commit it.

If your network uses a proxy, add the Hermes and VSS hosts to `no_proxy`.

### 3. Start

```bash
make up
```

`make up` runs the image set by `REGISTRY` and `TAG` in `deploy/.env`. It uses
the local image if available. Otherwise, it pulls the image or builds it from
source if the pull fails. See logs with `make logs`.

### 4. Check the Connections

```bash
for u in /healthz /hermes/health /vss/manager/health; do
  printf '%-22s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:12346$u)"
done
```

All three must return `200`. The sidebar footer also shows **Hermes** and **VSS**
as **Reachable**.

### 5. Run a Search

Open the VSG agent's **Argus** page at `http://<HOST_IP>:12346/argus`, then:

1. Describe the person, attach a photo, or both. Optionally, name cameras or a
   time range in the text.
2. Select **Send**. The VSG agent replies with a grid of potential matches.
3. Play a clip, **Confirm** the sightings that show the subject, and send the
   review.
4. Continue from the chat: crop and re-search, start a live camera search, or
   generate a report. The route appears on the **Floorplan** page.

See [Investigate a Person](./how-to-guides/investigate-a-person.md) for the
full walkthrough.

### 6. Stop

```bash
make down
```

## Next Steps

- [Build from Source](./get-started/build-from-source.md)
- [Run Unit Tests](./get-started/run-unit-tests.md)
- [How-to Guides](./how-to-guides.md)
- [Known Issues](./known-issues.md)

<!--hide_directive
:::{toctree}
:hidden:

./get-started/system-requirements.md
./get-started/set-up-prerequisite-stack.md
./get-started/build-from-source.md
./get-started/run-unit-tests.md

:::
hide_directive-->