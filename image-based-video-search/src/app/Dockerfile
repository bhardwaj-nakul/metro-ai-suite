# SPDX-FileCopyrightText: (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

FROM docker.io/library/node:26.7.0 AS base

USER root

# Pull Debian security fixes (addresses libpng/libpq/linux-libc-dev CVEs when available in node security)
RUN apt-get update \
  && apt-get -y upgrade \
  && apt-get -y autoremove \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Set the working directory inside the container
WORKDIR /usr/src/app

# Upgrade npm and patch its bundled dependencies without retaining the download cache.
# brace-expansion@5.0.11 fixes CVE-2026-102276 / CVE-2026-102278
# undici@6.29.1 fixes CVE-2026-109383 / CVE-2026-109869 / CVE-2026-87018
RUN npm install -g npm@latest && \
    tmpdir=$(mktemp -d) && \
    cd "$tmpdir" && \
    echo '{}' > package.json && \
    npm install --no-fund --no-audit --ignore-scripts \
      brace-expansion@5.0.11 ip-address@10.3.1 tar@7.5.21 undici@6.29.1 && \
    npm_pkg_dir=$(npm root -g)/npm/node_modules && \
    rm -rf "$npm_pkg_dir/brace-expansion" && cp -r node_modules/brace-expansion "$npm_pkg_dir/" && \
    rm -rf "$npm_pkg_dir/ip-address"     && cp -r node_modules/ip-address "$npm_pkg_dir/" && \
    rm -rf "$npm_pkg_dir/tar"            && cp -r node_modules/tar "$npm_pkg_dir/" && \
    rm -rf "$npm_pkg_dir/undici"         && cp -r node_modules/undici "$npm_pkg_dir/" && \
    cd /usr/src/app && \
    rm -rf "$tmpdir" && \
    npm cache clean --force

FROM base AS build

# Copy package.json and package-lock.json to the working directory
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application code to the working directory
COPY . .

# Build the Vue.js application
RUN npm run build

FROM base AS runtime

# Install serve globally *before* switching user, then patch its bundled
# compression dependency in place so transitive deps resolve correctly
# (compression@1.8.2 fixes CVE-2026-87776).
RUN npm install -g serve && \
    cd "$(npm root -g)/serve" && \
    npm install --no-save --omit=dev --no-fund --no-audit --ignore-scripts compression@1.8.2 && \
    rm -f package-lock.json && \
    cd /usr/src/app && \
    npm cache clean --force

# Expose the port the app runs on
EXPOSE 3000

# Add non root user
ARG USER=intelmicroserviceuser
ARG UID=1999
RUN useradd -ms /bin/bash "${USER}" -o -u "${UID}" && \
    chown "${USER}:${USER}" /usr/src/app
COPY --from=build --chown=${USER}:${USER} /usr/src/app/dist ./dist
USER ${USER}

# Serve built static files
CMD ["serve", "-s", "dist", "-l", "3000"]
