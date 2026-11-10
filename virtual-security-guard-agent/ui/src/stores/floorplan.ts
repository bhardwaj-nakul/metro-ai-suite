// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { create } from "zustand";
import type { Unavailable } from "@/protocol/instructions";
import { persist } from "zustand/middleware";
import { persistStorage } from "@/lib/storage";
import { uid } from "@/lib/utils";
import { freePlanTags, planCamera } from "@/features/map/tags";
import {
  floorplanSchema,
  parseFloorplan,
  type Floorplan,
} from "@/features/map/schema";

/** Served by nginx from deploy/floorplans/$VSG_FLOORPLAN.json (or by Vite in dev). */
export const DEFAULT_FLOORPLAN_URL = "/floorplan.json";

const EMPTY_PLAN: Floorplan = { cameras: {} };
const FLOORPLAN_STORAGE_KEY = "vsg.floorplan.v1";

interface FloorplanState {
  plan: Floorplan;
  source: "default" | "upload";
  fileName?: string;
  /** The deployment's plan from {@link DEFAULT_FLOORPLAN_URL}. */
  defaultPlan?: Floorplan;
  defaultStatus: "loading" | "ready" | "error";
  defaultError?: string;
  /** A saved upload that no longer validates; shown once, then cleared. */
  discardedUpload?: string;
  /** Marks the current upload in storage, to check that it was saved. */
  uploadId?: string;
  /**
   * Use an uploaded plan. Returns false when it couldn't be saved in the
   * browser (storage full): it is shown now but gone after a reload.
   */
  setPlan: (plan: Floorplan, fileName?: string) => boolean;
  reset: () => void;
}

/**
 * Active facility floorplan. Only an uploaded plan is persisted; otherwise
 * the deployment's default plan is used, so changing it takes effect on the
 * next page load. Each plan camera's key is its VSS tag; tags are set only in
 * the floorplan file.
 */
export const useFloorplanStore = create<FloorplanState>()(
  persist(
    (set, get) => ({
      plan: EMPTY_PLAN,
      source: "default",
      defaultStatus: "loading",
      setPlan: (plan, fileName) => {
        const uploadId = uid("plan");
        set({ plan, source: "upload", fileName, uploadId });
        // persistStorage swallows a quota error, so read the write back.
        return !!localStorage
          .getItem(FLOORPLAN_STORAGE_KEY)
          ?.includes(`"uploadId":"${uploadId}"`);
      },
      reset: () =>
        set({
          plan: get().defaultPlan ?? EMPTY_PLAN,
          source: "default",
          fileName: undefined,
        }),
    }),
    {
      name: FLOORPLAN_STORAGE_KEY,
      storage: persistStorage(),
      partialize: ({ plan, source, fileName, uploadId }) =>
        source === "upload" ? { plan, source, fileName, uploadId } : { source },
      merge: (persisted, current) => {
        const p = persisted as Partial<FloorplanState> | undefined;
        const parsed =
          p?.source === "upload"
            ? floorplanSchema.safeParse(p.plan)
            : undefined;
        if (!parsed) return current;
        if (!parsed.success)
          return {
            ...current,
            discardedUpload: p?.fileName ?? "uploaded plan",
          };
        return {
          ...current,
          plan: parsed.data,
          source: "upload",
          fileName: p?.fileName,
        };
      },
    },
  ),
);

let defaultLoad: Promise<void> | undefined;

/**
 * Fetch the deployment's default plan once; later calls share the result.
 * A failed load is not kept, so the next call tries again.
 */
export function loadDefaultFloorplan(): Promise<void> {
  defaultLoad ??= fetchDefaultFloorplan().then(() => {
    if (useFloorplanStore.getState().defaultStatus === "error")
      defaultLoad = undefined;
  });
  return defaultLoad;
}

async function fetchDefaultFloorplan() {
  let error: string;
  try {
    const res = await fetch(DEFAULT_FLOORPLAN_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseFloorplan(await res.text());
    if (parsed.ok) {
      useFloorplanStore.setState((s) => ({
        defaultPlan: parsed.plan,
        defaultStatus: "ready",
        defaultError: undefined,
        plan: s.source === "default" ? parsed.plan : s.plan,
      }));
      return;
    }
    error = parsed.error;
  } catch (e) {
    error = (e as Error).message;
  }
  useFloorplanStore.setState({
    defaultStatus: "error",
    defaultError: `Could not load ${DEFAULT_FLOORPLAN_URL}: ${error}`,
  });
}

/** Floorplan zone of the camera behind a VSS tag, when it is on the plan. */
export function cameraZone(tag: string | undefined): string | undefined {
  if (!tag) return undefined;
  return zoneOf(useFloorplanStore.getState().plan, tag);
}

/** Zone of the plan camera `tag`, if it is on the plan. */
export function zoneOf(plan: Floorplan, tag: string) {
  return planCamera(plan, tag)?.zone;
}

/**
 * Where a camera tag is: the zone of the plan camera holding it, else
 * `fallback` (a live stream's VSS description). The plan is the source of
 * truth for locations.
 */
export function useCameraLocation(
  tag: string | undefined,
  fallback?: string,
): string {
  const zone = useFloorplanStore((s) =>
    tag ? zoneOf(s.plan, tag) : undefined,
  );
  return zone ?? fallback ?? "";
}

/**
 * Plan cameras no live stream is placed on yet, as "tag (zone)" for Argus,
 * or why there is no plan to read them from.
 */
export function freeFloorplanCameras(
  streams: { tag: string }[],
): string[] | Unavailable {
  const { plan, source, defaultStatus, defaultError } =
    useFloorplanStore.getState();
  if (source === "default" && defaultStatus !== "ready")
    return { unavailable: defaultError ?? "floorplan not loaded" };
  return freePlanTags(plan, streams).map((tag) => {
    const zone = plan.cameras[tag].zone;
    return zone ? `${tag} (${zone})` : tag;
  });
}
