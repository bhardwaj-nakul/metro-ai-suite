# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Build a complete Gradio wheel, including its compiled frontend, from the
# exact Git commit pinned in uv.lock. A direct Git install omits the frontend.
FROM node:24.22.2-trixie-slim AS gradio-builder

ARG PNPM_VERSION=10.17.0
ARG PYPA_BUILD_VERSION=1.6.1

RUN apt-get update && \
  apt-get install -y --no-install-recommends git ca-certificates python3 python3-venv && \
  rm -rf /var/lib/apt/lists/*

RUN npm install --global "pnpm@${PNPM_VERSION}" && \
  python3 -m venv /opt/build-venv && \
  /opt/build-venv/bin/pip install --no-cache-dir "build==${PYPA_BUILD_VERSION}"

WORKDIR /gradio
COPY uv.lock /tmp/uv.lock
RUN gradio_source="$(python3 -c 'import tomllib; lock = tomllib.load(open("/tmp/uv.lock", "rb")); print(next(p["source"]["git"] for p in lock["package"] if p["name"] == "gradio"))')" && \
  gradio_repo="${gradio_source%%\?*}" && \
  gradio_commit="${gradio_source##*#}" && \
  git init -q && \
  git remote add origin "${gradio_repo}" && \
  git fetch -q --depth 1 origin "${gradio_commit}" && \
  git checkout -q --detach FETCH_HEAD && \
  test "$(git rev-parse HEAD)" = "${gradio_commit}"

# Mirrors Gradio's scripts/build_frontend.sh and wheel release steps.
RUN pnpm install --frozen-lockfile --ignore-scripts && \
  pnpm build && \
  python3 scripts/download_offline_assets.py && \
  /opt/build-venv/bin/python -m build --wheel --outdir /dist && \
  python3 -c 'import glob, zipfile; wheels = glob.glob("/dist/gradio-*.whl"); assert len(wheels) == 1; assert "gradio/templates/frontend/index.html" in zipfile.ZipFile(wheels[0]).namelist()'

FROM python:3.12-slim AS builder

# Set working directory
WORKDIR /app

# Copy code into the container
RUN pip install --no-cache-dir "uv>=0.9.22,<1.0.0"
COPY . .
COPY --from=gradio-builder /dist/ /tmp/gradio-dist/
RUN uv sync --frozen --no-install-project --no-install-package gradio && \
  uv pip install --python /app/.venv/bin/python --no-deps /tmp/gradio-dist/gradio-*.whl && \
  /app/.venv/bin/python -c 'from importlib.resources import files; assert files("gradio").joinpath("templates/frontend/index.html").is_file()'

FROM python:3.12-slim AS runtime

ARG USER_ID=1000
ARG USER_GROUP_ID=1000

WORKDIR /app

COPY --from=builder /usr/local/bin/uv /usr/local/bin/uv
COPY --from=builder /app /app

# Keep uv run from replacing the built Gradio wheel with the Git source.
ENV UV_NO_SYNC=1

# Create non-root user and change ownership
RUN groupadd -g ${USER_GROUP_ID} routeuser && \
  useradd -m -s /usr/sbin/nologin -u ${USER_ID} -g ${USER_GROUP_ID} routeuser && \
  chown -R routeuser:routeuser /app

USER routeuser

# Expose ports for the Gradio interface and the Intersections API
EXPOSE 7860
EXPOSE 8765

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD uv run python health_check.py 7860 || exit 1

# Run the application
CMD ["uv", "run", "python", "main.py"]
