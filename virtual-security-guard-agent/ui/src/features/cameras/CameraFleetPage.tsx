// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useMemo, useRef, useState } from "react";
import { Cctv, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import type { StreamInput } from "@/adapters/vss/types";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useCameraPolling,
  useCamerasStore,
  type Camera,
  type CameraStatus,
} from "@/stores/cameras";
import { CameraCard } from "./CameraCard";
import { STATUS_META } from "./status";
import { CameraFormDialog } from "./CameraFormDialog";
import { useLastDefined } from "./useLastDefined";
import { useFloorplanStore, zoneOf } from "@/stores/floorplan";
import { freePlanTags } from "@/features/map/tags";

/** Opens the add dialog; disabled once every floorplan camera has a stream. */
function AddCameraButton({
  full,
  variant,
  onClick,
}: {
  full: boolean;
  variant?: "outline";
  onClick: () => void;
}) {
  const button = (
    <Button variant={variant} onClick={onClick} disabled={full}>
      <Plus /> Add camera
    </Button>
  );
  if (!full) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A disabled button gets no pointer events, so the span shows the tip. */}
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        Every camera on the floorplan has a live stream. Remove one to add
        another.
      </TooltipContent>
    </Tooltip>
  );
}

/** Live cameras: the RTSP streams VSS is ingesting, with add/edit/pause/remove. */
export function CameraFleetPage() {
  const { cameras, loaded, error, load, add, update, remove } =
    useCamerasStore();
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Camera | "new">();
  const [deleting, setDeleting] = useState<Camera>();
  const [refreshing, setRefreshing] = useState(false);
  /** Cameras with a pause/resume request in flight. */
  const toggling = useRef(new Set<string>());
  const removing = useLastDefined(deleting);

  useCameraPolling();

  // Locations come from the plan, so re-sort when it or the mapping changes.
  const plan = useFloorplanStore((s) => s.plan);
  const planReady = useFloorplanStore(
    (s) => s.source !== "default" || s.defaultStatus === "ready",
  );
  // Only a loaded plan and camera list can tell that no camera is free.
  const planFull =
    planReady && loaded && freePlanTags(plan, cameras).length === 0;
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const where = (c: Camera) => zoneOf(plan, c.tag) ?? c.location;
    return cameras
      .filter(
        (c) =>
          !f ||
          `${c.tag} ${c.streamId} ${where(c)} ${c.ip ?? ""}`
            .toLowerCase()
            .includes(f),
      )
      .sort(
        (a, b) =>
          where(a).localeCompare(where(b)) || a.tag.localeCompare(b.tag),
      );
  }, [cameras, filter, plan]);
  const tally = useMemo(() => {
    const t: Record<CameraStatus, number> = {
      live: 0,
      starting: 0,
      paused: 0,
      offline: 0,
    };
    cameras.forEach((c) => t[c.status]++);
    return t;
  }, [cameras]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
    const err = useCamerasStore.getState().error;
    if (err) toast.error("Couldn't reach VSS", { description: err });
  }

  async function togglePause(c: Camera) {
    // A second click before VSS answers would send the same change twice.
    if (toggling.current.has(c.streamId)) return;
    toggling.current.add(c.streamId);
    const state = c.status === "paused" ? "running" : "paused";
    try {
      await update(c.streamId, { state });
      toast.success(
        state === "paused" ? `Paused ${c.tag}` : `Resumed ${c.tag}`,
      );
    } catch (e) {
      toast.error("Couldn't change the camera", {
        description: (e as Error).message,
      });
    } finally {
      toggling.current.delete(c.streamId);
    }
  }

  async function save(input: StreamInput) {
    if (editing === "new") {
      await add(input);
      toast.success(`Added ${input.name}`);
    } else if (editing) {
      await update(editing.streamId, {
        frameInterval: input.frameInterval,
        objectDetection: input.objectDetection,
      });
      toast.success(`Saved ${editing.tag}`);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    await remove(deleting.streamId);
    toast.success(`Removed ${deleting.tag}`);
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold">Live cameras</h2>
          <p className="text-sm text-muted-foreground">
            {cameras.length} camera{cameras.length === 1 ? "" : "s"}
            {(Object.keys(tally) as (keyof typeof tally)[])
              .filter((k) => tally[k])
              .map((k) => `, ${tally[k]} ${STATUS_META[k].label.toLowerCase()}`)
              .join("")}
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by camera, zone or IP"
            className="w-72 pl-8"
            aria-label="Filter cameras"
          />
        </div>
        <Button
          variant="outline"
          onClick={refresh}
          disabled={refreshing}
          aria-label="Refresh"
        >
          {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Refresh
        </Button>
        <AddCameraButton full={planFull} onClick={() => setEditing("new")} />
      </div>

      {error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          Couldn't reach VSS: {error}
          {cameras.length > 0 && " Camera statuses below may be out of date."}
        </p>
      )}

      {!loaded ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/3] rounded-none" />
          ))}
        </div>
      ) : shown.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">
          {shown.map((c) => (
            <CameraCard
              key={c.streamId}
              camera={c}
              onEdit={() => setEditing(c)}
              onTogglePause={() => void togglePause(c)}
              onDelete={() => setDeleting(c)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 border border-dashed py-16 text-center">
          <Cctv className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {cameras.length
              ? "No camera matches that filter."
              : "No live cameras yet. Add an RTSP camera, or ask Argus to add one."}
          </p>
          {!cameras.length && (
            <AddCameraButton
              full={planFull}
              variant="outline"
              onClick={() => setEditing("new")}
            />
          )}
        </div>
      )}

      <CameraFormDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(undefined)}
        camera={editing === "new" ? undefined : editing}
        onSave={save}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title={`Remove ${removing?.tag}?`}
        description="VSS stops ingesting this RTSP stream. Footage and embeddings already indexed stay searchable."
        action="Remove camera"
        errorTitle="Couldn't remove the camera"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
