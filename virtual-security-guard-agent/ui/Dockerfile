# SPDX-FileCopyrightText: (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Virtual Security Guard Agent UI: static SPA served by unprivileged nginx, which
# also proxies Hermes and VSS (see nginx/templates/default.conf.template).
# Build context: this directory (ui/).

FROM node:24.22.0-alpine AS build
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 \
    npm ci --no-audit --no-fund
COPY --chown=node:node . .
# An image is only built from code that passes lint and tests.
RUN npm run lint && npm test && npm run build

FROM nginxinc/nginx-unprivileged:1.30.6-alpine

LABEL org.opencontainers.image.title="vsg-ui" \
      org.opencontainers.image.description="Virtual Security Guard Agent UI and Hermes/VSS proxy" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.vendor="Intel Corporation"

COPY nginx/templates/ /etc/nginx/templates/
COPY nginx/vsg/ /etc/nginx/vsg/
COPY --chmod=0755 nginx/entrypoint/18-vsg-env.envsh /docker-entrypoint.d/18-vsg-env.envsh
COPY --from=build /app/dist /usr/share/nginx/html
COPY third-party-programs.txt /licenses/third-party-programs.txt

# Build-time only; the container runs as uid 101.
USER root

RUN sed -i 's/^worker_processes  auto;/worker_processes  1;/' /etc/nginx/nginx.conf \
    && grep -q '^worker_processes  1;' /etc/nginx/nginx.conf \
    && rm -f /etc/nginx/conf.d/default.conf \
    && chown -R root:root /etc/nginx /usr/share/nginx/html \
    && chmod -R a+rX,go-w /etc/nginx /usr/share/nginx/html \
    && chown 101:0 /etc/nginx/conf.d

# nginx-unprivileged: uid 101, listens on 8080, pid and temp files in /tmp.
USER 101
EXPOSE 8080

# -Y off: BusyBox wget ignores no_proxy, so a Docker client proxy would 403 this.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -Y off -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
