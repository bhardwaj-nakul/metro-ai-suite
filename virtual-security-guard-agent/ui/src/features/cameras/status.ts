// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { CameraStatus } from "@/stores/cameras";

export const STATUS_META: Record<
  CameraStatus,
  { label: string; tone: "success" | "info" | "pending" | "neutral" }
> = {
  live: { label: "Live", tone: "success" },
  starting: { label: "Starting", tone: "info" },
  paused: { label: "Paused", tone: "pending" },
  offline: { label: "Offline", tone: "neutral" },
};
