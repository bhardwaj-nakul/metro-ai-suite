# Copyright (C) 2025 Intel Corporation
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

FROM python:3.13-slim AS builder

# Set working directory
WORKDIR /app

# Install system dependencies and apply available security patches
# (e.g. CVE-2026-53615 affecting util-linux/login packages)
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install uv package manager
RUN pip install --no-cache-dir "uv>=0.9.22,<1.0.0"
COPY . .
COPY --from=gradio-builder /dist/ /tmp/gradio-dist/
# Create virtual environment and install dependencies using uv
RUN uv sync --frozen --no-install-project --no-dev --no-install-package gradio && \
    uv pip install --no-deps /tmp/gradio-dist/gradio-*.whl && \
    uv pip install -r ui/requirements.txt && \
    .venv/bin/python -c 'from importlib.resources import files; assert files("gradio").joinpath("templates/frontend/index.html").is_file()'

# Copy license file
COPY third_party_programs.txt /licenses/third_party_programs.txt

# Optionally download copyleft sources if requested
ARG COPYLEFT_SOURCES=false
RUN mkdir -p /copyleft_sources && \
    if [ "$COPYLEFT_SOURCES" = "true" ]; then \
        apt-get update && \
        # Get list of installed deb packages with copyleft licenses \
        sed -Ei 's/# deb-src /deb-src /' /etc/apt/sources.list && \
        apt-get update && \
        mkdir -p /copyleft_sources/deb && cd /copyleft_sources/deb && \
        echo -n $null > copyleft_package_list.txt && \
        for package in $(dpkg -l | awk '/^ii/ {print $2}' | cut -d: -f1); do \
            grep -l 'Copyleft\|GPL\|LGPL\|EPL\|MPL\|CDDL' /usr/share/doc/${package}/copyright; \
            exit_status=$?; \
            if [ $exit_status -eq 0 ]; then \
                echo $package >> copyleft_package_list.txt; \
                apt-get source -q --download-only $package; \
            fi; \
        done; \
        # Get source code for installed Python packages with copyleft licenses \
        mkdir -p /copyleft_sources/python && \
        cd /copyleft_sources/python && \
        apt-get update && apt-get install -y --no-install-recommends gcc build-essential libffi-dev python3-dev && \
        # Download python package sources with relevant licenses \
        pip3 freeze | cut -d= -f1 | while read pkg; do \
            meta=$(pip3 show $pkg 2>/dev/null); \
            lic=$(echo "$meta" | grep -i '^License:' | grep -E 'MPL|GPL|General Public License|EPL|Eclipse Public License|CDDL|LGPL'); \
            if [ ! -z "$lic" ]; then \
                echo "Downloading source for $pkg with license: $lic"; \
                pip3 download --no-binary :all: $pkg || true; \
            fi; \
        done; \
        apt-get remove --purge -y gcc build-essential libffi-dev python3-dev; \
    fi

FROM python:3.13-slim AS runtime

WORKDIR /app

RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app /app
COPY --from=builder /licenses /licenses
COPY --from=builder /copyleft_sources /copyleft_sources

# Remove the base image's system-wide pip/setuptools installation. The
# application runs entirely from the uv-managed virtual environment at
# /app/.venv (which has its own patched setuptools/msgpack), and pip is only
# needed above to bootstrap uv. Keeping the system pip around leaves its
# vendored (and outdated) copies of setuptools/msgpack in the image, which
# trigger known CVEs even though they are not used by the running app.
RUN python -m pip uninstall -y pip setuptools wheel 2>/dev/null; \
    rm -rf /usr/local/lib/python3.13/site-packages/pip* \
           /usr/local/lib/python3.13/site-packages/setuptools* \
           /usr/local/lib/python3.13/site-packages/pkg_resources* \
           /usr/local/lib/python3.13/site-packages/wheel* \
           /usr/local/bin/pip* /usr/local/bin/pip3*

# Create non-root user and adjust permissions
RUN useradd -m -u 1000 traffic && \
    chmod +x docker-entrypoint.sh && \
    chown -R traffic:traffic /app

# Switch to non-root user
USER traffic

# Update PATH to use venv
ENV PATH="/app/.venv/bin:$PATH"

# Expose API port and UI port
EXPOSE 8081 7860

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=10s \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8081/health', timeout=5).close()"]

# Run both API and UI services using entrypoint script
CMD ["bash", "docker-entrypoint.sh"]
