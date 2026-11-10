// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Build-time configuration. The SPA only ever talks to its own origin; the
 * nginx BFF (or the Vite dev proxy) forwards these prefixes to Hermes and VSS.
 */
export const env = {
  /** Same-origin prefix proxied to the Hermes API server. */
  hermesBase:
    (import.meta.env.VITE_HERMES_BASE as string | undefined) ?? "/hermes",
  /** Same-origin prefix proxied to the VSS gateway (…/manager, …/datastore). */
  vssBase: (import.meta.env.VITE_VSS_BASE as string | undefined) ?? "/vss",
  /** Replay a scripted Argus investigation without any backend. */
  useMocks: String(import.meta.env.VITE_USE_MOCKS ?? "false") === "true",
  /** Title prefix used to recognise VSG investigations among Hermes sessions. */
  sessionPrefix: "VSG · ",
  /** Release version; `version` in ui/package.json is the single source. */
  appVersion: __APP_VERSION__,
} as const;
