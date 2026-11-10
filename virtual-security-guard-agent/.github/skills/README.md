<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# VSG Skills

Coding-agent skills for the **Virtual Security Guard Agent (VSG)** sample
application. They teach an agent (GitHub Copilot CLI, Claude Code, Cursor, or
any harness that reads `SKILL.md`) how to work on VSG through its real
interfaces - the `Makefile`, `deploy/compose.yaml`, the nginx gateway, and the
Hermes and VSS APIs.

These are **not** the Hermes skills that make Argus behave; those live in
[`../../hermes-skills/`](../../hermes-skills/) and are installed on the Hermes
host with `make install-skills`.

A skill is a directory with a `SKILL.md` (YAML front matter + workflow) and
optional `references/` (deep docs loaded only when needed), `evals/`
(behaviour checks) and `example-prompts/`.

## Catalog

| Skill | Persona | Use it when you want to… |
|---|---|---|
| [`vsg-dev`](./vsg-dev/SKILL.md) | Contributor / Ops | Run the UI (mock or live), change features, add Hermes/VSS routes to the gateway, change the Argus protocol, verify, redeploy, or debug "Argus replied but the UI shows nothing". |

For VSS itself (deploy, streams, search, MCP server), use the VSS skills in
[`../../../video-search-and-summarization/.github/skills/`](../../../video-search-and-summarization/.github/skills/).

## Installation

Per user (Copilot CLI / Claude Code scan `~/.agents/skills/`):

```bash
VSG_SKILLS="$(pwd)/sample-applications/virtual-security-guard-agent/.github/skills"
mkdir -p ~/.agents/skills
for d in "$VSG_SKILLS"/vsg-*/; do ln -sfn "$d" ~/.agents/skills/"$(basename "$d")"; done
ls -l ~/.agents/skills | grep vsg-
```

Or point a project-local skills path at
`sample-applications/virtual-security-guard-agent/.github/skills`.

## Usage

Describe the task; the agent picks the skill from its `description`.

| You say… | Skill |
|---|---|
| "Run the VSG UI with mock data" | `vsg-dev` |
| "Argus replied but the report isn't shown" | `vsg-dev` |
| "Let the UI call a new VSS endpoint" | `vsg-dev` |
| "Change how Argus answers after a review" | `vsg-dev` |
| "Redeploy vsg-ui" | `vsg-dev` |

## Cross-Harness Discovery

- All agents start at [../copilot-instructions.md](../copilot-instructions.md).
- Root-level agents use [../../AGENTS.md](../../AGENTS.md) as a router.
- Claude agents use [../../CLAUDE.md](../../CLAUDE.md) as a router.
- Cursor agents start at [../../.cursor/rules/vsg.mdc](../../.cursor/rules/vsg.mdc).
- Tools that prefer structured metadata read [skill-catalog.json](./skill-catalog.json).
- Keep the skill body in one place: update each `SKILL.md`, then keep the
  catalog description and triggers in sync.
