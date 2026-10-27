# videostream-analytics

RTSP capture and motion segmentation service with an optional OpenVINO™
detector as a prefilter. Posts motion/static/recording events to a webhook
(the smart-community MCP server in the full stack).

## Quick start (standalone)

```bash
bash setup_vsa.sh        # validate/prepare the prefilter model, regenerate your config
bash setup_vsa.sh up     # docker compose up
curl -s localhost:8999/capabilities/prefilter | jq '.models[].name'
bash setup_vsa.sh down
```

`setup_vsa.sh` needs nothing from the rest of the smart-community repository.
Pre-exported environment (`PREFILTER_MODEL_DIR`, `VIDEOSTREAM_CACHE_HOST`) is
honored; sourcing the script instead defines the `vsa_*` functions without
running anything (this is how the full stack's `setup_docker.sh` reuses it).

## Your configuration

The live configuration is `${VIDEOSTREAM_CACHE_HOST}/config.yaml` (default
`~/.cache/.videostream-analytics/config.yaml`). Every run of `setup_vsa.sh`
(and of `setup_docker.sh`) regenerates it from `config/config.yaml.example`:
an identical file is left alone, a differing one is first saved as
`config.yaml.<YYYYMMDD-HHMMSS>.bak` next to it. **Put changes you want to keep in
`config/config.yaml.example`**; edits made directly to the live file take effect
at once (hot reload) but only last until the next deploy, and are then found in
the newest `.bak`. The `config/config.yaml` symlink in this directory points at
the live file.

Apply edits without a restart (running sources are untouched): the service
watches the file and reloads automatically within a couple of seconds, or
force it with

```bash
curl -X POST localhost:8999/config/reload
```

A plain `docker compose -f docker/docker-compose.yaml up` without setup still
works: it mounts the example template (defaults only, edits not persisted).
