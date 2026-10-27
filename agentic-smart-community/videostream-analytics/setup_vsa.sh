#!/bin/bash

# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# videostream-analytics standalone setup: prepares the prefilter model, seeds
# your own persistent configuration, and optionally drives docker compose.
#
# Usage:
#   bash setup_vsa.sh              prepare model + seed config, print exports
#   bash setup_vsa.sh up|down|logs prepare, then pass through to docker compose
#   source setup_vsa.sh            define vsa_* functions + defaults, no actions
#                                  (this is how setup_docker.sh reuses it)
#
# Environment (all optional; pre-exported values — e.g. from docker/set_env.sh
# in the full smart-community stack — are honored):
#   PREFILTER_MODEL_DIR   read-only model root bind-mounted into the container.
#                         Default ${HOME}/models/openvino. The bundled yolo11s
#                         is prepared at ${PREFILTER_MODEL_DIR}/yolo11s/FP16/;
#                         other models are registered in the config, not here.
#   VIDEOSTREAM_CACHE_HOST  your config home. config.yaml here is regenerated from
#                           config/config.yaml.example on every run; a differing
#                           previous copy is kept as config.yaml.<YYYYMMDD-HHMMSS>.bak.
#                           Default ${HOME}/.cache/.videostream-analytics.
#   VIDEOSTREAM_CONFIG_FILE default ${VIDEOSTREAM_CACHE_HOST}/config.yaml.

VSA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Inherit the caller's colors when sourced (setup_docker.sh sets these).
RED="${RED:-\033[0;31m}"
YELLOW="${YELLOW:-\033[0;33m}"
NC="${NC:-\033[0m}"

PREFILTER_MODEL_DIR="${PREFILTER_MODEL_DIR:-${HOME}/models/openvino}"
DEFAULT_PREFILTER_MODEL="${PREFILTER_MODEL_DIR}/yolo11s/FP16/yolo11s.xml"
VIDEOSTREAM_CACHE_HOST="${VIDEOSTREAM_CACHE_HOST:-${HOME}/.cache/.videostream-analytics}"
VIDEOSTREAM_CONFIG_FILE="${VIDEOSTREAM_CONFIG_FILE:-${VIDEOSTREAM_CACHE_HOST}/config.yaml}"

# Validate (and auto-prepare if missing) the bundled yolo11s IR pair. Sets the
# script-level VSA_PREFILTER_MODEL / VSA_MODEL_DIR to resolved absolute paths.
vsa_prepare_model() {
  local prefilter_bin prefilter_model model_dir

  prefilter_model="$(realpath -m "$DEFAULT_PREFILTER_MODEL")"
  prefilter_bin="${prefilter_model%.xml}.bin"
  if [[ ! -s "$prefilter_model" || ! -s "$prefilter_bin" ]]; then
    echo "Prefilter model is missing or incomplete: ${prefilter_model}"
    echo "Preparing the YOLO11s OpenVINO IR automatically..."
    IR_XML="$prefilter_model" bash "${VSA_DIR}/scripts/helpers/prepare_yolo11s.sh"
  fi

  if [[ ! -s "$prefilter_model" || ! -s "$prefilter_bin" ]]; then
    echo -e "${RED}Error: prefilter preparation did not create a complete IR pair: ${prefilter_model}${NC}"
    return 1
  fi
  prefilter_model="$(realpath -e "$prefilter_model")"

  model_dir="$(realpath -m "$PREFILTER_MODEL_DIR")"
  if [[ "$prefilter_model" != "$model_dir/"* ]]; then
    echo -e "${RED}Error: prefilter model must be under PREFILTER_MODEL_DIR (${model_dir}) so the container can read it.${NC}"
    return 1
  fi

  VSA_PREFILTER_MODEL="$prefilter_model"
  VSA_MODEL_DIR="$model_dir"
}

# Render the live config from the example on every run. An identical file is left
# untouched (no churn, no backup); a differing one is kept as
# config.yaml.<YYYYMMDD-HHMMSS>.bak before being replaced — the same convention as
# the MCP server's config. Then maintain the config/config.yaml symlink so the
# familiar in-tree path edits the same live file.
vsa_seed_config() {
  local rendered backup
  mkdir -p "$VIDEOSTREAM_CACHE_HOST"

  # Check before resolving: realpath would follow a symlink and the check below
  # would then approve (and overwrite) whatever it points at.
  if [[ -L "$VIDEOSTREAM_CONFIG_FILE" || ( -e "$VIDEOSTREAM_CONFIG_FILE" && ! -f "$VIDEOSTREAM_CONFIG_FILE" ) ]]; then
    echo -e "${RED}Error: ${VIDEOSTREAM_CONFIG_FILE} must be a regular file; refusing to replace it.${NC}" >&2
    return 1
  fi
  VIDEOSTREAM_CONFIG_FILE="$(realpath -m "$VIDEOSTREAM_CONFIG_FILE")"

  rendered="$(mktemp "${VIDEOSTREAM_CACHE_HOST}/.config.yaml.XXXXXX")"
  {
    # Pin the absolute, validated paths the container will see. The example
    # carries ${PREFILTER_MODEL_DIR} placeholders; writing the resolved values
    # here keeps the deployment working even if the variable is not exported
    # into the container.
    SEEDED_MODEL_PATH="$VSA_PREFILTER_MODEL" \
      python3 - "${VSA_DIR}/config/config.yaml.example" "$rendered" <<'PY'
import os
import sys
import tempfile

import yaml

source_path, output_path = sys.argv[1:]
with open(source_path, encoding="utf-8") as source_file:
    config = yaml.safe_load(source_file) or {}

defaults = config.setdefault("defaults", {}).setdefault("prefilter", {})
name = defaults.get("model") or "default"
defaults["model"] = name
registry = config.setdefault("prefilter_models", {})
entry = registry.setdefault(name, {})
entry.setdefault("kind", "detection")
entry.setdefault("backend", "openvino")
entry["model_path"] = os.environ["SEEDED_MODEL_PATH"]

output_dir = os.path.dirname(output_path)
with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=output_dir, delete=False) as output_file:
    yaml.safe_dump(config, output_file, default_flow_style=False, sort_keys=False)
    temporary_path = output_file.name
os.replace(temporary_path, output_path)
PY
  } || { rm -f "$rendered"; return 1; }

  if [[ -f "$VIDEOSTREAM_CONFIG_FILE" ]] && cmp -s "$rendered" "$VIDEOSTREAM_CONFIG_FILE"; then
    rm -f "$rendered"
    echo "Configuration unchanged: ${VIDEOSTREAM_CONFIG_FILE}"
  else
    if [[ -f "$VIDEOSTREAM_CONFIG_FILE" ]]; then
      backup="${VIDEOSTREAM_CONFIG_FILE}.$(date '+%Y%m%d-%H%M%S').bak"
      if [[ -e "$backup" || -L "$backup" ]]; then
        rm -f "$rendered"
        echo -e "${RED}Error: backup already exists: ${backup}${NC}" >&2
        return 1
      fi
      cp -- "$VIDEOSTREAM_CONFIG_FILE" "$backup"
      echo "Backed up ${VIDEOSTREAM_CONFIG_FILE} to ${backup}"
    fi
    mv -- "$rendered" "$VIDEOSTREAM_CONFIG_FILE"
    echo "Updated configuration: ${VIDEOSTREAM_CONFIG_FILE} (from config/config.yaml.example)"
  fi

  vsa_link_config
}

vsa_link_config() {
  local link="${VSA_DIR}/config/config.yaml"
  if [[ -L "$link" ]]; then
    if [[ "$(readlink "$link")" != "$VIDEOSTREAM_CONFIG_FILE" ]]; then
      ln -sfn "$VIDEOSTREAM_CONFIG_FILE" "$link"
      echo "Updated symlink: ${link} -> ${VIDEOSTREAM_CONFIG_FILE}"
    fi
  elif [[ -e "$link" ]]; then
    echo -e "${YELLOW}Warning: ${link} exists as a regular file; leaving it alone.${NC}"
    echo "Your live configuration is ${VIDEOSTREAM_CONFIG_FILE} — edit that file instead."
  else
    ln -s "$VIDEOSTREAM_CONFIG_FILE" "$link"
    echo "Linked ${link} -> ${VIDEOSTREAM_CONFIG_FILE} (edit either path; same file)"
  fi
}

vsa_prepare() {
  vsa_prepare_model || return 1
  vsa_seed_config || return 1
  export PREFILTER_MODEL_DIR="$VSA_MODEL_DIR"
  export VIDEOSTREAM_CACHE_HOST VIDEOSTREAM_CONFIG_FILE
  echo "Using prefilter model: ${VSA_PREFILTER_MODEL}"
  echo "Using videostream configuration: ${VIDEOSTREAM_CONFIG_FILE}"
}

# Dual mode: sourced → definitions only; executed → prepare, then subcommand.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -e
  vsa_prepare
  case "${1:-}" in
    "")
      echo
      echo "To start videostream-analytics:  bash $0 up"
      ;;
    up | down | logs)
      docker compose -f "${VSA_DIR}/docker/docker-compose.yaml" "$@"
      ;;
    *)
      echo -e "${RED}Unknown subcommand: $1 (expected: up | down | logs)${NC}" >&2
      exit 2
      ;;
  esac
fi
