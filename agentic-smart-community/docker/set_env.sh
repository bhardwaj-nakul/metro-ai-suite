# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# On-device deployment environment: a single llm-scaler serving instance (one
# multimodal model filling BOTH the VLM and LLM roles) plus the
# multilevel-video-understanding microservice, running locally on Intel PTL
# with shared system RAM.
#
# Usage:   source docker/set_env.sh      # before ./setup_docker.sh / docker compose up
# Reset:   source docker/set_env.sh --reset   # reload only variables defaulted in this file
# Includes HF_ENDPOINT and other active ${VAR:-...}/${VAR:=...} assignments, not commented examples.
# Preserves proxies, credentials, HF_HUB_OFFLINE, and TZ; does not change running containers.
# Prints key effective settings and an environment-precedence reminder to stderr.

if [[ "${1:-}" == "--reset" ]]; then
  unset HF_HOME HF_ENDPOINT MODEL_SERVING_BACKEND \
    LLM_MODEL MAX_MODEL_LEN LOAD_QUANTIZATION GPU_MEM_UTIL TENSOR_PARALLEL_SIZE \
    VLLM_OFFLOAD_WEIGHTS_BEFORE_QUANT REGISTRY_URL TAG \
    VLM_BASE_URL LLM_BASE_URL VLM_MODEL_NAME LLM_MODEL_NAME \
    VIDEO_SUMMARY_CACHE_HOST SMART_COMMUNITY_DATA_DIR \
    WEBHOOK_URL PREFILTER_MODEL_DIR VIDEOSTREAM_CACHE_HOST || return 1
  printf '%s\n' \
    '[set_env] Resetting only variables defaulted in this file; running containers unchanged.' >&2
fi

# Local services are reached over loopback or by compose service name.
# Preserve caller-supplied hosts so an external model serving can bypass a proxy.
for _sc_host in localhost 127.0.0.1 model-serving "model-serving-${MODEL_SERVING_BACKEND:-llm-scaler}" multilevel-video-understanding; do
  case ",${no_proxy:-}," in
    *",${_sc_host},"*) ;;
    *) no_proxy="${no_proxy:+${no_proxy},}${_sc_host}" ;;
  esac
done
export no_proxy
unset _sc_host

# =========================================================================
# llm-scaler model serving
# =========================================================================
export VIDEO_GROUP_ID=$(getent group video  | awk -F: '{print $3}')
export RENDER_GROUP_ID=$(getent group render | awk -F: '{print $3}')

# Host directory that caches downloaded Hugging Face weights.
HF_HOME=${HF_HOME:=~/models/huggingface}
export HF_HOME
# Create if not exists, so Docker bind-mounts it as a user-owned dir instead of root-owned.
mkdir -p "${HF_HOME}"

# Uncomment this line to disable Hugging Face's online checks for new versions of transformers, accelerate, etc.
# export HF_HUB_OFFLINE=1

# Change to https://hf-mirror.com if you are in China and want to use the mirror site for Hugging Face.
# export HF_ENDPOINT=https://hf-mirror.com
export HF_ENDPOINT=${HF_ENDPOINT:-https://huggingface.co}

export MODEL_SERVING_BACKEND=${MODEL_SERVING_BACKEND:-llm-scaler}

# Model + context window.
export LLM_MODEL=${LLM_MODEL:-Qwen/Qwen3.6-35B-A3B}
export MAX_MODEL_LEN=${MAX_MODEL_LEN:-61440}

# Device-memory budget for profiling and KV cache, not a whole-host RAM cap.
export LOAD_QUANTIZATION=${LOAD_QUANTIZATION:-fp8}
export GPU_MEM_UTIL=${GPU_MEM_UTIL:-0.7}
export VLLM_OFFLOAD_WEIGHTS_BEFORE_QUANT=${VLLM_OFFLOAD_WEIGHTS_BEFORE_QUANT:-0}
export TENSOR_PARALLEL_SIZE=${TENSOR_PARALLEL_SIZE:-1}  # single integrated GPU on PTL

export VLLM_SERVICE_PORT=41091


# =========================================================================
# multilevel-video-understanding microservice
# =========================================================================
# Its source (edge-ai-libraries) is not vendored here — setup_docker.sh clones it
# into the fixed path .external/edge-ai-libraries, which docker/compose.yaml
# `extends` from. No env var needed.
export REGISTRY_URL=${REGISTRY_URL:-intel/}
export REGISTRY=${REGISTRY_URL}
export TAG=${TAG:-latest}                     # set as the latest release version
export SERVICE_PORT=8192

# Run multilevel-video-understanding as the host user
# To ensure bind-mount directories (e.g. ~/.cache/...) are available in container
export USER_GROUP_ID="$(id -g "$USER")"

# Both roles are served by the same on-device llm-scaler endpoint by default. The
# caller may instead set these standard MLVU variables to reuse another serving.
export VLM_BASE_URL=${VLM_BASE_URL:-http://model-serving:8000/v1}
export LLM_BASE_URL=${LLM_BASE_URL:-http://model-serving:8000/v1}
# Preserve the bundled-serving model defaults. setup_docker.sh verifies both
# selected IDs against the endpoint's standard /v1/models response before the
# application tier starts.
export VLM_MODEL_NAME=${VLM_MODEL_NAME:-${LLM_MODEL}}
export LLM_MODEL_NAME=${LLM_MODEL_NAME:-${LLM_MODEL}}
export MAX_CONCURRENT_REQUESTS=4
export DEFAULT_MAX_TOKENS=1024
export ENABLE_THINKING=false
export VIDEO_FRAME_HEIGHT=378
export VIDEO_FRAME_WIDTH=504
export DEFAULT_TEMPERATURE=0.0

# Runtime prompt-registry cache. Must exist as a user-owned dir BEFORE
# `docker compose up`, otherwise Docker creates it as root.
export VIDEO_SUMMARY_CACHE_HOST=${VIDEO_SUMMARY_CACHE_HOST:-${HOME}/.cache/.multilevel-video-understanding}
mkdir -p "${VIDEO_SUMMARY_CACHE_HOST}/tasks"

# =========================================================================
# integrate with Smart Community MCP Server
# =========================================================================

# The summary container reads this data root at the same absolute path as the host.
export SMART_COMMUNITY_DATA_DIR=${SMART_COMMUNITY_DATA_DIR:-${HOME}/.mcp-smart-community}
mkdir -p "${SMART_COMMUNITY_DATA_DIR}"

# Run smart-community-mcp-server and videostream-analytics as the host user
export HOST_UID=$(id -u)
export HOST_GID=$(id -g)

# Host timezone, passed into the MCP server container so SQLite's
# datetime('now','localtime') (used for every event/alert created_at) matches host
# local time instead of defaulting to UTC. Prefer /etc/timezone, fall back to the
# /etc/localtime symlink target; leave unset if neither is resolvable (the image's
# ENV TZ default and the /etc/localtime bind mount then apply).
if [ -z "${TZ:-}" ]; then
  if [ -r /etc/timezone ]; then
    TZ=$(cat /etc/timezone)
  elif [ -L /etc/localtime ]; then
    TZ=$(readlink -f /etc/localtime | sed 's#.*/zoneinfo/##')
  fi
  [ -n "${TZ:-}" ] && export TZ
fi

# =========================================================================
# videostream-analytics (RTSP capture + NPU YOLO prefilter)
# =========================================================================
# Runs on the host network, so it reaches the MCP server's EventsEndpoint (the
# smart-community-mcp-server container, also on the host network, at localhost:3101 —
# see docker/mcp-server/). Override only if the MCP server listens elsewhere.
export WEBHOOK_URL=${WEBHOOK_URL:-http://localhost:3101/events}

# Prefilter model root.
export PREFILTER_MODEL_DIR=${PREFILTER_MODEL_DIR:-${HOME}/models/openvino}

# VSA's user-owned configuration home
export VIDEOSTREAM_CACHE_HOST=${VIDEOSTREAM_CACHE_HOST:-${HOME}/.cache/.videostream-analytics}
mkdir -p "${VIDEOSTREAM_CACHE_HOST}"

# Only list model settings; endpoint URLs and other environment values may contain credentials.
printf '%s\n' \
  '[set_env] Effective settings:' \
  "  MODEL_SERVING_BACKEND=${MODEL_SERVING_BACKEND} | TAG=${TAG}" \
  "  LLM_MODEL=${LLM_MODEL} | VLM_MODEL_NAME=${VLM_MODEL_NAME} | LLM_MODEL_NAME=${LLM_MODEL_NAME}" \
  "  LOAD_QUANTIZATION=${LOAD_QUANTIZATION} | MAX_MODEL_LEN=${MAX_MODEL_LEN} | GPU_MEM_UTIL=${GPU_MEM_UTIL} | TENSOR_PARALLEL_SIZE=${TENSOR_PARALLEL_SIZE}" \
  "  VLLM_OFFLOAD_WEIGHTS_BEFORE_QUANT=${VLLM_OFFLOAD_WEIGHTS_BEFORE_QUANT}" \
  '[set_env] Existing env wins; reset defaults in this file: source docker/set_env.sh --reset' >&2
