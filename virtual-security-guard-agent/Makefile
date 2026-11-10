# SPDX-FileCopyrightText: (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Virtual Security Guard Agent: developer and deployment targets. Run `make help`.

SHELL := /bin/bash
.DEFAULT_GOAL := help

UI_DIR      := ui
COMPOSE     := docker compose -f deploy/compose.yaml
REGISTRY    ?=
TAG         ?= latest
IMAGE       := $(REGISTRY)intel/vsg-ui:$(TAG)
# Where `make install-skills` puts SOUL.md and the skills (run on the Hermes host).
HERMES_HOME ?= $(HOME)/.hermes
HERMES_SKILLS_DIR ?= $(HERMES_HOME)/skills/security
# `make up` takes REGISTRY and TAG from deploy/.env unless they are given on the command line.
UP_ENV      := $(if $(filter command line,$(origin REGISTRY)),REGISTRY=$(REGISTRY)) $(if $(filter command line,$(origin TAG)),TAG=$(TAG))

.PHONY: help install dev dev-mock lint format test e2e check build-ui build push env up down logs install-skills clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install UI dependencies (npm ci)
	cd $(UI_DIR) && npm ci

dev: ## Run the UI dev server against live Hermes/VSS (needs ui/.env.local)
	cd $(UI_DIR) && npm run dev

dev-mock: ## Run the UI dev server with scripted mock adapters (offline)
	cd $(UI_DIR) && npm run dev:mock

lint: ## Lint and type-check the UI
	cd $(UI_DIR) && npm run lint && npx tsc -p tsconfig.app.json --noEmit

format: ## Format the UI sources with Prettier
	cd $(UI_DIR) && npm run format

test: ## Run the UI unit tests (vitest)
	cd $(UI_DIR) && npm test

e2e: ## Run the Playwright end-to-end tests on the mock adapters
	cd $(UI_DIR) && npm run test:e2e

check: lint test ## Lint, type-check and test

build: ## Build the container image ($(IMAGE))
	docker build -t $(IMAGE) $(UI_DIR)

push: build ## Push the container image
	docker push $(IMAGE)

env: ## Create or update deploy/.env from deploy/.env.example (HERMES_BASE_URL=... HERMES_API_KEY=... VSS_BASE_URL=...)
	@test -n "$$HERMES_BASE_URL" -a -n "$$HERMES_API_KEY" -a -n "$$VSS_BASE_URL" || \
		{ echo "Usage: make env HERMES_BASE_URL=http://<hermes-host-ip>:8642 HERMES_API_KEY=<key> VSS_BASE_URL=http://<vss-host>:12345"; exit 1; }
	@src=deploy/.env.example; test ! -e deploy/.env || src=deploy/.env; \
	umask 077 && awk '/^(HERMES_BASE_URL|HERMES_API_KEY|VSS_BASE_URL)=/ { k = substr($$0, 1, index($$0, "=") - 1); print k "=" ENVIRON[k]; next } { print }' \
		"$$src" > deploy/.env.tmp && mv deploy/.env.tmp deploy/.env
	@echo "Wrote deploy/.env"

up: ## Start the UI (needs deploy/.env): use the local image, else pull it, else build it
	@test -f deploy/.env || { echo "Create deploy/.env from deploy/.env.example first."; exit 1; }
	@img="$$($(UP_ENV) $(COMPOSE) config --images vsg-ui)"; \
	if docker image inspect "$$img" >/dev/null 2>&1; then echo "Using $$img"; \
	elif $(UP_ENV) $(COMPOSE) pull --quiet vsg-ui 2>/dev/null; then echo "Pulled $$img"; \
	else echo "$$img is not in a registry; building it"; $(UP_ENV) $(COMPOSE) build vsg-ui; fi
	$(UP_ENV) $(COMPOSE) up -d

down: ## Stop the UI
	$(COMPOSE) down

logs: ## Follow the UI container logs
	$(COMPOSE) logs -f

install-skills: ## Install SOUL.md + Hermes skills (HERMES_HOME, HERMES_SKILLS_DIR; INSTALL_ARGS=--exclusive removes other skills) and restart the gateway
	HERMES_HOME="$(HERMES_HOME)" HERMES_SKILLS_DIR="$(HERMES_SKILLS_DIR)" bash hermes-skills/install.sh $(INSTALL_ARGS)

clean: ## Remove UI build output
	rm -rf $(UI_DIR)/dist $(UI_DIR)/coverage
