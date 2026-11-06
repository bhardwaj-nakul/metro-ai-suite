# Get Started

This guide provides the demo setup steps for the OpenClaw service, the Data Intelligence Engine
(knowledge base retrieval), the vLLM service, the Router service, the Compressor service, and the
UI service.

## Prerequisites

Before you begin, ensure the following:

- **System Requirements:** Verify that your system meets the [minimum requirements](./get-started/system-requirements.md).
- **GPU Driver Installed:** This guide assumes that the target machine already has the Intel GPU driver. Otherwise, follow the official [Installing Packages from the Intel PPA](https://dgpu-docs.intel.com/installation-guides/installing-packages-from-the-intel-ppa.html) guide.
- **Docker Installed:** Install Docker by following [Get Docker](https://docs.docker.com/get-docker/).
- **Core command-line tools:** All services — including the MCP server — run as containers, so the host only needs `git` to clone the repo and `curl` / `jq` for the setup script and health checks:

  ```bash
  sudo apt-get update
  sudo apt-get install -y git curl jq
  ```

## Table of Contents

- [1. Set Up Router and Compressor Services](#1-set-up-router-and-compressor-services)
- [2. Set Up vLLM and the Data Intelligence Engine](#2-set-up-vllm-and-the-data-intelligence-engine)
- [3. Set Up OpenClaw](#3-set-up-openclaw)
  - [3.1 Install and Onboard OpenClaw](#31-install-and-onboard-openclaw)
  - [3.2 Configure `openclaw.json`](#32-configure-openclawjson)
  - [3.3 Install Repository Skills into the OpenClaw Agent Directory](#33-install-repository-skills-into-the-openclaw-agent-directory)
  - [3.4 Enable the Skill in OpenClaw Configuration](#34-enable-the-skill-in-openclaw-configuration)
- [4. Set Up the UI](#4-set-up-the-ui)
- [5. Test the Configuration](#5-test-the-configuration)
- [6. Use the Knowledgebase Skill](#6-use-the-knowledgebase-skill)

## 1. Set Up Router and Compressor Services

The Router and Compressor services are set up separately. See the
[Inference Router](https://docs.openedgeplatform.intel.com/dev/edge-ai-libraries/inference-router/index.html)
microservice for the full instructions on generating the configuration and starting both
services.

## 2. Set Up vLLM and the Data Intelligence Engine

The OpenClaw agent and the Router use a local vLLM service on port `8086` for the
`Qwen/Qwen3.5-35B-A3B` model. The knowledge base is served by the
[Data Intelligence Engine](https://github.com/open-edge-platform/edge-ai-libraries/tree/main/microservices/data-intelligence-engine)
on port `16022`. The engine embeds documents, retrieves the most relevant chunks, and returns
them to the Skills. It does not generate answers; the OpenClaw agent writes the
answer from the retrieved chunks.

### a. Prepare the LLM model

```bash
python3 -m venv model_download_venv
source model_download_venv/bin/activate
pip install modelscope
export MODEL_PATH=${PWD}/workspace/models
export LLM_MODEL="Qwen/Qwen3.5-35B-A3B"
modelscope download --model $LLM_MODEL --local_dir "${MODEL_PATH}/${LLM_MODEL}"
# clean venv
deactivate
rm -rf model_download_venv
```

### b. Start vLLM

> [!NOTE]
> `LLM_MODEL` and `MODEL_PATH` were set in [Prepare the LLM model](#a-prepare-the-llm-model). Ensure both remain exported in the current shell.

```bash
docker run -d --name vllm-serving --restart always --privileged \
  --device /dev/dri:/dev/dri \
  -p 8086:8086 \
  -v "${MODEL_PATH}:/workspace/vllm/models" \
  -e LLM_MODEL="${LLM_MODEL}" \
  -e ZE_AFFINITY_MASK=0 \
  --entrypoint /bin/bash \
  intel/llm-scaler-vllm:0.21.0-b1 \
  -c 'cd /workspace/vllm/models && \
    VLLM_OFFLOAD_WEIGHTS_BEFORE_QUANT=0 \
    TORCH_LLM_ALLREDUCE=1 \
    VLLM_USE_V1=1 \
    CCL_ZE_IPC_EXCHANGE=pidfd \
    VLLM_ALLOW_LONG_MAX_MODEL_LEN=1 \
    VLLM_WORKER_MULTIPROC_METHOD=spawn \
    python3 -m vllm.entrypoints.openai.api_server \
      --model "${LLM_MODEL}" \
      --dtype float16 \
      --enforce-eager \
      --port 8086 \
      --trust-remote-code \
      --disable-sliding-window \
      --gpu-memory-util 0.8 \
      --no-enable-prefix-caching \
      --max-num-batched-tokens 8192 \
      --max-model-len 49152 \
      --block-size 64 \
      --quantization fp8 \
      --max-num-seqs 128 \
      -tp=1 \
      -dp=1 \
      --enable_prefix_caching True \
      --enable-auto-tool-choice \
      --tool-call-parser qwen3_coder'
```

Loading the model takes several minutes. Follow the progress with `docker logs -f vllm-serving`,
and verify the service once it is up:

```bash
curl http://localhost:8086/v1/models | jq '.'
```

### c. Start the Data Intelligence Engine

Clone the engine with a pinned commit and start it with its one-click script. Text ingestion
and retrieval need only the GME model, which embeds both the documents and the queries, so
prepare just that one. The script builds the engine image, prepares GME, starts Milvus and the
engine on port `16022`, and registers Milvus as `local-milvus`. It needs Docker Compose v2,
`curl`, and `jq`.

```bash
git clone --filter=blob:none --sparse https://github.com/open-edge-platform/edge-ai-libraries.git
cd edge-ai-libraries
git sparse-checkout set microservices/data-intelligence-engine
git checkout 0d78bc1f905fc016b9f609456a2d8d8dd3ed1153
cd microservices/data-intelligence-engine

# If you have a HF mirror configured, it is used for the model download
export HF_ENDPOINT=https://hf-mirror.com # your HF mirror endpoint
bash scripts/quickstart.sh --models "gme"

cd scripts
./status.sh health
```

Later runs only need `bash scripts/quickstart.sh` to start the services again. Run the commands
in the following steps from the `scripts` directory.

### d. Create the Knowledge Base

The Skills search the asset library `enterprise-kb` by default. Create the library, a source
that indexes into Milvus with the default text model, and a pool named `documents` that binds
them:

```bash
./library.sh create '{"name":"enterprise-kb"}'
./sources.sh create enterprise-kb '{"name":"docs","database_id":"local-milvus","collection_name":"enterprise_kb_docs"}'
./pools.sh create enterprise-kb '{"id":"documents","name":"Documents","sources":["docs"]}'
```

### e. Add Data

Write a sample text file and ingest it. `--wait` returns once the file is indexed:

```bash
cat > /tmp/intel_products.txt <<'EOF'
Intel Core Ultra X7 358H is a mobile processor designed for high-performance laptops. It combines
CPU, integrated Intel graphics, and NPU capabilities to support productivity, content creation,
and AI workloads.
EOF
./assets.sh add enterprise-kb /tmp/intel_products.txt --pool documents --wait
```

Add your own text documents the same way; a folder path ingests every supported file in it.

### f. Verify Retrieval

```bash
./retrieve.sh query enterprise-kb "What is Intel Core Ultra X7 358H?" --pool documents --top-k 5 \
  | jq '.chunks[] | {score, file: .metadata.file_name, text}'
```

The engine returns the retrieved chunks in `chunks`; this is the same `POST /v1/retrieve`
request that the `knowledgebase` and `competitive_analysis_PDF_generator` Skills send. If you
use a different engine address, library, or pool, set `KB_ENGINE_URL`, `KB_LIBRARY`, or
`KB_POOL` in the environment of the OpenClaw gateway.

## 3. Set Up OpenClaw

### 3.1 Install and Onboard OpenClaw

If you do not have OpenClaw yet, install it from the official repository at
<https://github.com/openclaw/openclaw>. Install `openclaw@2026.5.6`:

```bash
# openclaw needs Node.js >= 22.14.0
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=14)?0:1)' \
  || { echo "ERROR: Node.js >= 22.14.0 required, found $(node -v)"; exit 1; }

npm install -g openclaw@2026.5.6
```

Use the following choices in the onboarding wizard. Skip all online provider/channel/skill
configuration for now and configure them manually in the following sections:

```bash
openclaw onboard --install-daemon
```

| Wizard Step | Selection |
| --- | --- |
| Onboarding mode | **QuickStart** |
| Model / auth provider | **Skip for now** |
| Filter models by provider | **All providers** |
| Default model | **Keep current** |
| Select channel | **Skip for now** |
| Configure skills now | **No** |
| Enable hooks | **Skip for now** |
| How do you want to hatch your bot? | **Do this later** |

If you are using an internally packaged version or a preinstalled environment, make sure you
can access the following:

- OpenClaw executable
- `openclaw.json` configuration file
- A usable agent workspace, for example `~/.openclaw/workspace`

### 3.2 Configure `openclaw.json`

Before editing the configuration, stop the `openclaw gateway` service:

```bash
openclaw gateway stop
```

Edit `~/.openclaw/openclaw.json`.

The `~/.openclaw/openclaw.json` file generated by `openclaw onboard` already includes the
basic skeleton such as `gateway`, `tools.profile`, and `agents.list[main]`, so **you do not need to replace the entire file**. Merge the following sections into it:

- `models.providers`: add the `minimax`, `vllm`, and `proxy-101` providers
- `tools`: append web search using `tavily`
- `agents`:
  - configure `subagents`
  - add `vllm/Qwen/Qwen3.5-35B-A3B`, `minimax/MiniMax-M2.7`, `proxy-101/auto`, and `proxy-101/Qwen/Qwen3.5-35B-A3B` under `models`
  - configure `model`
  - configure `llm`
- `plugins`: add the `tavily` configuration
- `gateway`: configure `controlUi`

```json
{
  "agents": {
    "defaults": {
      "workspace": "${HOME}/.openclaw/workspace",
      "compaction": {
        "mode": "safeguard"
      },
      "subagents": {
        "maxConcurrent": 2,
        "maxSpawnDepth": 1,
        "maxChildrenPerAgent": 1,
        "model": "proxy-101/Qwen/Qwen3.5-35B-A3B",
        "runTimeoutSeconds": 1500
      },
      "models": {
        "vllm/Qwen/Qwen3.5-35B-A3B": {},
        "minimax/MiniMax-M2.7": {
          "alias": "Minimax"
        },
        "proxy-101/auto": {
          "alias": "Router"
        },
        "proxy-101/Qwen/Qwen3.5-35B-A3B": {
          "alias": "Router-Qwen3.5-35B-A3B"
        },
        "minimax/MiniMax-M2.7-highspeed": {}
      },
      "model": {
        "primary": "proxy-101/auto",
        "fallbacks": [
          "vllm/Qwen/Qwen3.5-35B-A3B",
          "minimax/MiniMax-M2.7-highspeed",
          "proxy-101/Qwen/Qwen3.5-35B-A3B",
          "minimax/MiniMax-M2.7"
        ]
      },
      "llm": {
        "idleTimeoutSeconds": 800
      }
    },
    "list": [
      {
        "id": "main"
      },
      {
        "id": "auto",
        "name": "auto",
        "subagents": {
          "model": "vllm/Qwen/Qwen3.5-35B-A3B"
        },
        "workspace": "${HOME}/.openclaw/workspace-auto",
        "agentDir": "${HOME}/.openclaw/agents/auto/agent",
        "model": {
          "primary": "proxy-101/auto"
        }
      },
      {
        "id": "intro-self",
        "name": "intro-self",
        "workspace": "/tmp/intro-self",
        "agentDir": "${HOME}/.openclaw/agents/intro-self/agent",
        "model": "proxy-101/auto"
      }
    ]
  },
  "gateway": {
    "mode": "local",
    "auth": {
      "mode": "token",
      "token": ""
    },
    "port": 18789,
    "bind": "loopback",
    "tailscale": {
      "mode": "off",
      "resetOnExit": false
    },
    "controlUi": {
      "allowedOrigins": [
        "http://localhost:18789",
        "http://127.0.0.1:18789",
        "http://localhost:7000",
        "http://127.0.0.1:7000"
      ],
      "allowInsecureAuth": true,
      "dangerouslyDisableDeviceAuth": true
    },
    "nodes": {
      "denyCommands": [
        "camera.snap",
        "camera.clip",
        "screen.record",
        "contacts.add",
        "calendar.add",
        "reminders.add",
        "sms.send",
        "sms.search"
      ]
    }
  },
  "session": {
    "dmScope": "per-channel-peer"
  },
  "tools": {
    "profile": "coding",
    "web": {
      "search": {
        "provider": "tavily",
        "enabled": true
      }
    }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "proxy-101": {
        "baseUrl": "http://localhost:8000/v1",
        "apiKey": "fake",
        "api": "openai-completions",
        "models": [
          {
            "id": "Qwen/Qwen3.5-35B-A3B",
            "name": "Qwen/Qwen3.5-35B-A3B",
            "reasoning": false,
            "input": [
              "text"
            ],
            "cost": {
              "input": 0,
              "output": 0,
              "cacheRead": 0,
              "cacheWrite": 0
            },
            "contextWindow": 128000,
            "maxTokens": 8192
          },
          {
            "id": "auto",
            "name": "auto",
            "reasoning": false,
            "input": [
              "text"
            ],
            "cost": {
              "input": 0,
              "output": 0,
              "cacheRead": 0,
              "cacheWrite": 0
            },
            "contextWindow": 200000,
            "maxTokens": 8192
          }
        ]
      },
      "vllm": {
        "baseUrl": "http://localhost:8086/v1",
        "api": "openai-completions",
        "apiKey": "VLLM_API_KEY",
        "models": [
          {
            "id": "Qwen/Qwen3.5-35B-A3B",
            "name": "Qwen/Qwen3.5-35B-A3B",
            "reasoning": false,
            "input": [
              "text"
            ],
            "cost": {
              "input": 0,
              "output": 0,
              "cacheRead": 0,
              "cacheWrite": 0
            },
            "contextWindow": 90000,
            "maxTokens": 8192
          }
        ]
      },
      "minimax": {
        "baseUrl": "https://api.minimaxi.com/anthropic",
        "models": [
          {
            "id": "MiniMax-M2.7",
            "name": "MiniMax M2.7",
            "reasoning": true,
            "input": [
              "text",
              "image"
            ],
            "cost": {
              "input": 0.3,
              "output": 1.2,
              "cacheRead": 0.06,
              "cacheWrite": 0.375
            },
            "contextWindow": 204800,
            "maxTokens": 131072
          }
        ],
        "api": "anthropic-messages",
        "apiKey": "${MINIMAX_API_KEY}",
        "authHeader": true
      }
    }
  },
  "plugins": {
    "entries": {
      "tavily": {
        "enabled": true,
        "config": {
          "webSearch": {
            "apiKey": "${TAVILY_API_KEY}"
          }
        }
      },
      "vllm": {
        "enabled": true
      },
      "minimax": {
        "enabled": true
      }
    }
  },
  "skills": {
    "entries": {
      "competitive_analysis_PDF_generator": {
        "enabled": true
      }
    }
  }
}
```

Remember to put `MINIMAX_API_KEY` into `${HOME}/.openclaw/.env`. Do not use `~/` in `openclaw.json`,
because it is not allowed.

### 3.3 Install Repository Skills into the OpenClaw Agent Directory

Skill files in this repository cannot remain only in the repository. They must be copied into
the workspace of the corresponding OpenClaw agent so that OpenClaw can load them.

The most common target directory is:

- `~/.openclaw/workspace/skills/`

If you only need `competitive_analysis_PDF_generator`, copy it as follows:

```bash
mkdir -p ~/.openclaw/workspace/skills
cp -r ./skills/competitive_analysis_PDF_generator ~/.openclaw/workspace/skills/
```

### 3.4 Enable the Skill in OpenClaw Configuration

After copying the skill directory, you also need to enable it in `openclaw.json`:

```json
{
  "skills": {
    "entries": {
      "competitive_analysis_PDF_generator": {
        "enabled": true
      }
    }
  }
}
```

This step tells OpenClaw:

- This skill exists
- The agent is allowed to load it at runtime

After copying, restart the gateway:

```bash
openclaw gateway restart
```

Verify whether the skill is available:

```bash
openclaw tui

# In tui:
/reset
# Then ask:
"Can you use competitive_analysis_PDF_generator?"
```

## 4. Set Up the UI

> [!NOTE]
> OpenClaw must be configured and running before you use the UI. Standalone UI-only mode is not supported; without OpenClaw, the UI starts and serves HTTP on port 7000 but reports backend connection errors.

Use Docker Compose to build and start the UI container:

```bash
cd <enterprise-data-intelligence_repo>/ui/docker

# Set the required environment variables.
# VITE_AUTH_TOKEN should match gateway.auth.token in openclaw.json.
export VITE_AUTH_TOKEN=<your-auth-token>
export SERVER_HOST=<your-server-ip>

# Build the UI image.
docker compose -f build.yaml build

# Start the UI container.
docker compose -f compose.yaml up -d
```

By default, the UI is available at:

```text
http://<SERVER_HOST>:7000
```

## 5. Test the Configuration

Install `weasyprint`:

```bash
sudo apt install weasyprint
```

After completing the setup steps above, verify the configuration as follows:

1. Open the UI in a browser: `http://<HOST_IP>:7000`
2. Enter the verification prompt:

```text
Generate a competitive analysis report for Unitree Robotics G1 Basic and comparable products on the market.
```

Expected result: The UI should display a professional HTML/PDF report comparing the Unitree
Robotics G1 Basic with other products, generated using the `competitive_analysis_PDF_generator` skill.

## 6. Use the Knowledgebase Skill

First install the `knowledgebase` skill the same way as in Steps 3.3–3.4 — copy its directory
into the workspace and register it in `openclaw.json`:

```bash
cp -r ./skills/knowledgebase ~/.openclaw/workspace/skills/
```

Add it alongside the other skill under `skills.entries` in `openclaw.json`:

```json
{
  "skills": {
    "entries": {
      "knowledgebase": {
        "enabled": true
      }
    }
  }
}
```

Then restart the gateway so OpenClaw picks it up:

```bash
openclaw gateway restart
```

If the Large Language Model (LLM) is not strong enough to use the knowledgebase skill
automatically, add the following instruction to OpenClaw's `AGENTS.md`:

```text
For any user question, query, summarization, overview, or comparison, you must use the knowledgebase skill!
Do not answer questions by searching for files!
```

Insert the text into the "Tools" chapter in `$HOME/.openclaw/workspace/AGENTS.md`, for example:

```md
## Tools

Skills provide your tools. When you need one, check its `SKILL.md`. Keep local notes (camera names, SSH details, voice preferences) in `TOOLS.md`.

For any user question, query, summarization, overview, or comparison, you must use the knowledgebase skill!
Do not answer questions by searching for files!
```

<!--hide_directive
:::{toctree}
:hidden:

./get-started/system-requirements.md

:::
hide_directive-->
