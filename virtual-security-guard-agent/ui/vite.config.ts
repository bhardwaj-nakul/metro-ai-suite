// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFile } from "node:fs/promises";
import path from "path";
import pkg from "./package.json" with { type: "json" };

/**
 * Dev-server proxy mirroring the production nginx BFF (ui/nginx/default.conf.template):
 *   /hermes/*         -> HERMES_BASE_URL       (Authorization injected server-side)
 *   /vss/manager/*    -> VSS_BASE_URL/manager
 *   /vss/datastore/*  -> VSS_BASE_URL/datastore
 * HERMES_API_KEY is read without the VITE_ prefix so it is never bundled into the SPA.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const hermes = env.HERMES_BASE_URL || "http://127.0.0.1:8642";
  const vss = env.VSS_BASE_URL || "http://127.0.0.1:12345";
  const floorplan = env.VSG_FLOORPLAN || "simple";

  const hermesProxy: ProxyOptions = {
    target: hermes,
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/hermes/, ""),
    headers: env.HERMES_API_KEY
      ? { Authorization: `Bearer ${env.HERMES_API_KEY}` }
      : undefined,
    configure: (proxy) => {
      // Hermes rejects browser Origins it has not allowlisted (CORS is off).
      proxy.on("proxyReq", (req) => req.removeHeader("origin"));
      proxy.on("proxyRes", (res) => {
        if ((res.headers["content-type"] ?? "").includes("text/event-stream")) {
          res.headers["cache-control"] = "no-cache";
          res.headers["x-accel-buffering"] = "no";
        }
      });
    },
  };

  return {
    // Release version shown in the UI footer; bump it with `npm version`.
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    plugins: [
      react(),
      tailwindcss(),
      // Same as nginx: /floorplan.json is deploy/floorplans/$VSG_FLOORPLAN.json.
      {
        name: "vsg-floorplan",
        configureServer(server) {
          server.middlewares.use("/floorplan.json", (_req, res) => {
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(floorplan)) {
              res.statusCode = 500;
              res.end(`Bad VSG_FLOORPLAN '${floorplan}'`);
              return;
            }
            const file = path.resolve(
              import.meta.dirname,
              "../deploy/floorplans",
              `${floorplan}.json`,
            );
            readFile(file).then(
              (body) => {
                res.setHeader("Content-Type", "application/json");
                res.setHeader("Cache-Control", "no-cache");
                res.end(body);
              },
              () => {
                res.statusCode = 404;
                res.end();
              },
            );
          });
        },
      },
    ],
    // Tailwind runs as a Vite plugin; an inline config also stops PostCSS from
    // picking up a stray postcss.config.js from a parent directory.
    css: { postcss: { plugins: [] } },
    resolve: {
      alias: { "@": path.resolve(import.meta.dirname, "./src") },
    },
    server: {
      port: 5173,
      proxy: {
        "/hermes": hermesProxy,
        "/vss": {
          target: vss,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/vss/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (req) => req.removeHeader("origin"));
            proxy.on("proxyRes", (res, req) => {
              if (/^\/vss\/datastore\/.*\.mp4(\?|$)/i.test(req.url ?? ""))
                res.headers["content-type"] = "video/mp4";
            });
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      css: false,
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
