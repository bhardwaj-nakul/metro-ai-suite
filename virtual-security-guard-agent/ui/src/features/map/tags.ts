// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { StreamInput } from "@/adapters/vss/types";
import type { Floorplan, FloorplanCamera } from "./schema";

/** The plan camera whose key is `tag`. Each plan camera key is its VSS tag. */
export function planCamera(
  plan: Floorplan,
  tag: string,
): FloorplanCamera | undefined {
  return Object.hasOwn(plan.cameras, tag) ? plan.cameras[tag] : undefined;
}

/** How a plan camera shows on the map. */
export type CameraState = "live" | "mapped" | "empty";

/** Live if a live stream uses its tag, mapped if VSS knows the tag, else empty. */
export function cameraState(
  tag: string,
  vssTags: ReadonlySet<string> | undefined,
  liveTags: ReadonlySet<string>,
): CameraState {
  if (liveTags.has(tag)) return "live";
  if (!vssTags || vssTags.has(tag)) return "mapped";
  return "empty";
}

/** VSS tags that are not a plan camera key: their sightings cannot be drawn. */
export function offPlanTags(plan: Floorplan, vssTags: string[]): string[] {
  return vssTags.filter((t) => !planCamera(plan, t));
}

/** Plan camera tags that have a live stream placed on them. */
export function placedTags(
  plan: Floorplan,
  streams: { tag: string }[],
): Set<string> {
  return new Set(streams.map((s) => s.tag).filter((t) => planCamera(plan, t)));
}

/** Plan camera tags with no live stream yet, in plan order. */
export function freePlanTags(
  plan: Floorplan,
  streams: { tag: string }[],
): string[] {
  const placed = placedTags(plan, streams);
  return Object.keys(plan.cameras).filter((t) => !placed.has(t));
}

/**
 * The VSS stream for a live camera placed on plan camera `tag`: the tag is
 * its name and only tag, and its zone is the description.
 */
export function placementInput(
  plan: Floorplan,
  tag: string,
  opts: Omit<StreamInput, "name" | "tags" | "description">,
): StreamInput {
  return {
    ...opts,
    name: tag,
    tags: [tag],
    description: planCamera(plan, tag)?.zone ?? "",
  };
}
