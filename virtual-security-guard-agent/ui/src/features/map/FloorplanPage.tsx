// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { formatBytes } from "@/lib/utils";
import { MapLegend } from "@/features/map/MapLegend";
import { RouteStopList } from "@/features/map/RouteStopList";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router";
import {
  Cctv,
  Copy,
  Download,
  FileJson,
  Plus,
  RotateCcw,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import type { StreamInput } from "@/adapters/vss/types";
import { StatusChip } from "@/components/shared/media";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useKnownTags } from "@/hooks/queries";
import { CameraFormDialog } from "@/features/cameras/CameraFormDialog";
import { useCameraPolling, useCamerasStore } from "@/stores/cameras";
import { useFloorplanStore } from "@/stores/floorplan";
import { useRoute } from "@/hooks/useRoute";
import { offPlanTags, planCamera } from "./tags";
import { layoutRoute } from "./route";
import { MAX_FLOORPLAN_BYTES, parseFloorplan } from "./schema";
import { SpatialMap } from "./SpatialMap";

/** The minimal floorplan from the product brief. */
function downloadJson(data: unknown, fileName: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Facility floorplan: upload, cameras and the latest traced route. */
export function FloorplanPage() {
  const {
    plan,
    source,
    fileName,
    setPlan,
    reset,
    defaultStatus,
    defaultError,
  } = useFloorplanStore();
  const noPlan = source === "default" && defaultStatus !== "ready";
  const stops = useRoute();
  const tags = useKnownTags();
  const [addingAt, setAddingAt] = useState<string>();
  const cameras = useCamerasStore((s) => s.cameras);
  const addCamera = useCamerasStore((s) => s.add);
  const [selected, setSelected] = useState<string>();
  const [replay, setReplay] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const offPlan = useMemo(
    () => (tags ? offPlanTags(plan, tags) : []),
    [plan, tags],
  );
  const offMap = useMemo(() => layoutRoute(stops, plan).offMap, [stops, plan]);
  const cam = selected ? planCamera(plan, selected) : undefined;
  const selectedLive = !!selected && cameras.some((c) => c.tag === selected);

  const liveTags = useMemo(
    () => cameras.filter((c) => c.status === "live").map((c) => c.tag),
    [cameras],
  );

  useCameraPolling();

  async function addAt(input: StreamInput) {
    await addCamera(input);
    toast.success(`Added ${input.name}`);
  }

  async function load(file: File) {
    if (file.size > MAX_FLOORPLAN_BYTES) {
      toast.error("That file is too large", {
        description: `Floorplans must be under ${formatBytes(MAX_FLOORPLAN_BYTES)}.`,
      });
      return;
    }
    const res = parseFloorplan(await file.text());
    if (!res.ok) {
      toast.error("That floorplan isn't valid", { description: res.error });
      return;
    }
    const saved = setPlan(res.plan, file.name);
    setSelected(undefined);
    if (!saved)
      toast.error("The floorplan couldn't be saved in this browser", {
        description:
          "It is shown now but will be gone after a reload. Browser storage is full; use a smaller background image or clear local data in Settings.",
      });
    const off = tags ? offPlanTags(res.plan, tags).length : 0;
    toast.success("Floorplan loaded", {
      description: off
        ? `${file.name}. ${off} VSS camera${off > 1 ? "s aren't" : " isn't"} on this plan; add ${off > 1 ? "them" : "it"} to the floorplan file as camera keys.`
        : file.name,
    });
  }

  const dropProps = {
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget === e.target) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) void load(f);
    },
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <FileJson className="size-4 text-brand-accent" />
        <h2 className="text-sm font-semibold">
          {plan.name ?? fileName ?? "Floorplan"}
        </h2>
        <StatusChip tone="neutral">
          {source === "default" ? "Default plan" : fileName}
        </StatusChip>
        {offPlan.length > 0 && (
          <OffPlanCameras tags={offPlan} routeAffected={offMap.length > 0} />
        )}
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          title="Download the current plan to use as a template"
          onClick={() => downloadJson(plan, fileName ?? "floorplan.json")}
        >
          <Download /> Download JSON
        </Button>
        {source === "upload" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const { plan: uploaded, fileName } = useFloorplanStore.getState();
              reset();
              setSelected(undefined);
              toast("Using the default floorplan", {
                action: {
                  label: "Undo",
                  onClick: () =>
                    useFloorplanStore.getState().setPlan(uploaded, fileName),
                },
              });
            }}
          >
            <RotateCcw /> Use default
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void load(f);
            e.target.value = "";
          }}
        />
        <Button size="sm" onClick={() => fileRef.current?.click()}>
          <Upload /> Upload JSON
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div
          className="relative min-h-0 flex-1 overflow-auto p-4"
          {...dropProps}
        >
          {noPlan ? (
            <p
              role={defaultStatus === "error" ? "alert" : undefined}
              className="mx-auto max-w-xl py-16 text-center text-sm text-muted-foreground"
            >
              {defaultStatus === "error"
                ? `${defaultError}. Check VSG_FLOORPLAN and deploy/floorplans/, or upload a plan.`
                : "Loading floorplan…"}
            </p>
          ) : (
            <SpatialMap
              plan={plan}
              stops={stops}
              liveTags={liveTags}
              vssTags={tags}
              replayKey={replay}
              labels="all"
              selectedKey={selected}
              onCameraClick={(k) =>
                setSelected((s) => (s === k ? undefined : k))
              }
              className="mx-auto max-h-[calc(100vh-12rem)] w-full max-w-6xl border"
              title={plan.name ?? "Facility floorplan"}
            />
          )}
          <MapLegend />
          {dragging && (
            <div className="pointer-events-none absolute inset-4 flex items-center justify-center border-2 border-dashed border-brand-accent bg-background/80 text-sm font-medium text-brand-accent">
              Drop a floorplan JSON file
            </div>
          )}
        </div>

        <aside className="w-full shrink-0 overflow-auto border-t bg-sidebar lg:w-80 lg:border-t-0 lg:border-l">
          <section className="border-b px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
              Camera
            </h3>
            {cam && selected ? (
              <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Zone</dt>
                <dd>{cam.zone ?? "None"}</dd>
                <dt className="text-muted-foreground">Camera</dt>
                <dd className="truncate font-mono text-xs leading-5">
                  {selected}
                </dd>
                {!selectedLive && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="col-span-2 mt-2"
                    onClick={() => setAddingAt(selected)}
                  >
                    <Plus /> Add live camera here
                  </Button>
                )}
              </dl>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Cctv className="size-4" /> Select a camera on the map.
              </p>
            )}
          </section>

          <section className="px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-muted-foreground">
                Latest route
              </h3>
              {stops.length > 0 && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setReplay((r) => r + 1)}
                >
                  <RotateCcw /> Replay
                </Button>
              )}
            </div>
            {stops.length ? (
              <>
                <RouteStopList stops={stops} />
                {offMap.length > 0 && (
                  <p className="mt-3 text-xs text-pending">
                    {offMap.length} sighting
                    {offMap.length > 1 ? "s are" : " is"} on cameras that aren't
                    on this plan.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No route yet. Confirm a sighting in{" "}
                <Link to="/argus" className="text-brand-accent hover:underline">
                  Argus
                </Link>{" "}
                to trace it here.
              </p>
            )}
          </section>
        </aside>
      </div>

      <CameraFormDialog
        open={!!addingAt}
        onOpenChange={(o) => !o && setAddingAt(undefined)}
        tag={addingAt}
        onSave={addAt}
      />
    </div>
  );
}

/**
 * Copy a camera tag. The Clipboard API only exists on HTTPS or localhost, so
 * over plain HTTP the tag is selected for the operator to copy instead.
 */
function copyTag(tag: string, el: HTMLElement) {
  if (navigator.clipboard) {
    void navigator.clipboard.writeText(tag).then(
      () => toast.success(`Copied ${tag}`),
      (e: Error) => toast.error("Couldn't copy", { description: e.message }),
    );
    return;
  }
  getSelection()?.selectAllChildren(el);
  toast.info(`Selected ${tag}`, {
    description:
      "This page isn't served over HTTPS, so press Ctrl+C (or Cmd+C) to copy it.",
  });
}

/** VSS cameras the plan has no key for, listed so they can be added to the file. */
function OffPlanCameras({
  tags,
  routeAffected,
}: {
  tags: string[];
  routeAffected: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* A warning only when the route actually loses sightings. */}
        <button type="button" className="cursor-pointer">
          <StatusChip tone={routeAffected ? "pending" : "neutral"}>
            {routeAffected && <TriangleAlert />}
            {tags.length} VSS camera{tags.length > 1 ? "s" : ""} not on plan
          </StatusChip>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <p className="border-b px-3 py-2 text-xs text-muted-foreground">
          {routeAffected
            ? "Some route sightings are on these cameras and can't be drawn."
            : "Sightings on these cameras can't be drawn on this plan."}{" "}
          Add them to the floorplan file as camera keys.
        </p>
        <ul className="max-h-64 overflow-auto py-1">
          {tags.map((t) => (
            <li key={t} className="flex items-center gap-2 px-3 py-1">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {t}
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Copy ${t}`}
                onClick={(e) => copyTag(t, e.currentTarget.closest("li")!)}
              >
                <Copy />
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
