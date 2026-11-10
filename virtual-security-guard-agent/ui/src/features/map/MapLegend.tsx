// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { cn } from "@/lib/utils";

/** Same colours as the camera and stop markers in SpatialMap. */
const ITEMS = [
  { label: "Live stream", dot: "bg-live" },
  { label: "Recorded footage", dot: "bg-camera" },
  { label: "No footage", dot: "border-[1.5px] border-camera" },
  { label: "Route", dot: "bg-track" },
];

/** Key for the floorplan's camera and route markers. */
export function MapLegend({ className }: { className?: string }) {
  return (
    <ul
      aria-label="Map legend"
      className={cn(
        "mx-auto mt-2 flex max-w-6xl flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {ITEMS.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-full", i.dot)} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
