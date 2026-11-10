// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { env } from "@/config/env";
import { createHttpHermes } from "./hermes/http";
import { createMockHermes } from "./hermes/mock";
import type { HermesAdapter } from "./hermes/types";
import { createHttpVss } from "./vss/http";
import { createMockVss } from "./vss/mock";
import type { VssAdapter } from "./vss/types";

export interface Adapters {
  hermes: HermesAdapter;
  vss: VssAdapter;
  mock: boolean;
}

let current: Adapters | undefined;

function create(useMocks: boolean): Adapters {
  return {
    hermes: useMocks ? createMockHermes() : createHttpHermes(),
    vss: useMocks ? createMockVss() : createHttpVss(),
    mock: useMocks,
  };
}

/** Backend seam: real HTTP clients, or scripted mocks when VITE_USE_MOCKS=true. */
export function getAdapters(): Adapters {
  current ??= create(env.useMocks);
  return current;
}
