// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import type { StreamInput } from "@/adapters/vss/types";
import { StatusChip } from "@/components/shared/media";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  freePlanTags,
  placedTags,
  placementInput,
  planCamera,
} from "@/features/map/tags";
import { useTags } from "@/hooks/queries";
import { useCamerasStore, type Camera } from "@/stores/cameras";
import { useFloorplanStore } from "@/stores/floorplan";

interface FormState {
  streamUrl: string;
  /** Floorplan camera key: the stream's name and its one VSS tag. */
  tag: string;
  frameInterval: string;
  objectDetection: boolean;
}

const empty = (tag = ""): FormState => ({
  streamUrl: "",
  tag,
  frameInterval: "15",
  objectDetection: true,
});

const NO_ZONE = "Other";

function validateStream(
  f: FormState,
  editing: boolean,
  taken: ReadonlySet<string>,
) {
  const errors: Partial<Record<keyof FormState, string>> = {};
  if (!editing) {
    const url = f.streamUrl.trim();
    if (!url) errors.streamUrl = "Enter the camera's RTSP URL.";
    else if (!/^rtsps?:\/\/[^\s/]+/i.test(url))
      errors.streamUrl = "Use an rtsp:// or rtsps:// URL.";
  }
  if (!editing && !f.tag)
    errors.tag = "Choose where this camera is on the floorplan.";
  else if (!editing && taken.has(f.tag))
    errors.tag = `${f.tag} already has a live stream. Choose another camera.`;
  const n = Number(f.frameInterval);
  if (!Number.isInteger(n) || n < 1 || n > 60)
    errors.frameInterval = "Choose a whole number from 1 to 60.";
  return errors;
}

/**
 * Add a live RTSP camera to VSS, or edit its indexing. A new camera is placed
 * on a free floorplan camera: its key becomes the stream's name and only VSS
 * tag, and its zone the description. The position can't change afterwards;
 * remove the camera and add it again to move it.
 */
export function CameraFormDialog({
  open,
  onOpenChange,
  camera: cameraProp,
  tag: initialTag,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  camera?: Camera;
  /** Floorplan camera (tag) to preselect for a new camera. */
  tag?: string;
  onSave: (input: StreamInput) => Promise<void>;
}) {
  const plan = useFloorplanStore((s) => s.plan);
  const planMissing = useFloorplanStore(
    (s) => s.source === "default" && s.defaultStatus !== "ready",
  );
  const planError = useFloorplanStore((s) => s.defaultError);
  const cameras = useCamerasStore((s) => s.cameras);
  const loadCameras = useCamerasStore((s) => s.load);
  const [form, setForm] = useState<FormState>(empty);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  /** Bumped on every open, so a save from an earlier opening is ignored. */
  const opening = useRef(0);
  // While it animates closed the dialog keeps showing the camera it had open.
  const [shown, setShown] = useState(cameraProp);
  if (open && shown !== cameraProp) setShown(cameraProp);
  const camera = open ? cameraProp : shown;
  const editing = !!camera;

  useEffect(() => {
    if (!open) return;
    opening.current++;
    void loadCameras();
    setTouched(false);
    setSaving(false);
    setSaveError(undefined);
    setForm(
      camera
        ? {
            streamUrl: camera.url,
            tag: camera.tag,
            frameInterval: String(camera.frameInterval ?? 15),
            objectDetection: camera.objectDetection ?? true,
          }
        : empty(initialTag),
    );
  }, [open, camera, initialTag, loadCameras]);

  /** Plan cameras that already have a live stream. */
  const taken = useMemo(() => placedTags(plan, cameras), [cameras, plan]);

  const byZone = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const [k, c] of Object.entries(plan.cameras)) {
      const zone = c.zone ?? NO_ZONE;
      groups.set(zone, [...(groups.get(zone) ?? []), k]);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
  }, [plan]);
  const free = freePlanTags(plan, cameras).length;

  const errors = validateStream(form, editing, taken);
  const set =
    (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  const tag = form.tag;
  const node = tag ? planCamera(plan, tag) : undefined;
  const vssTags = useTags().data;
  // The position once had a stream: its recorded footage shares the tag.
  const hasFootage = !editing && !!tag && !!vssTags?.includes(tag);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (saving || Object.keys(errors).length) return;
    const mine = opening.current;
    setSaving(true);
    setSaveError(undefined);
    try {
      await onSave(
        placementInput(plan, tag, {
          streamUrl: form.streamUrl.trim(),
          frameInterval: Number(form.frameInterval),
          objectDetection: form.objectDetection,
        }),
      );
      // The dialog may since have been reopened for another camera.
      if (mine === opening.current) onOpenChange(false);
    } catch (err) {
      if (mine === opening.current) setSaveError((err as Error).message);
    } finally {
      if (mine === opening.current) setSaving(false);
    }
  }

  // VSS may still add the camera after an early close, so wait for the answer.
  const close = (o: boolean) => {
    if (!o && saving) return;
    onOpenChange(o);
  };

  const field = (
    k: keyof FormState,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`cam-${k}`}>{label}</Label>
      <Input
        id={`cam-${k}`}
        value={form[k] as string}
        onChange={set(k)}
        aria-invalid={touched && !!errors[k]}
        {...props}
      />
      {touched && errors[k] && (
        <p className="text-xs text-destructive">{errors[k]}</p>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${camera.tag}` : "Add live camera"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Changes apply to the running stream in VSS."
                : "VSS connects to the RTSP stream and starts indexing it for search."}
            </DialogDescription>
          </DialogHeader>
          {field("streamUrl", "RTSP URL", {
            placeholder: "rtsp://10.0.0.12:8554/lobby",
            disabled: editing,
            autoFocus: !editing,
            spellCheck: false,
          })}
          {editing ? (
            <div className="grid gap-1.5">
              <Label>Camera</Label>
              <p className="text-sm">
                <span className="font-mono text-xs">{camera.tag}</span>
                {node?.zone && <>, zone {node.zone}</>}
              </p>
              {!node && (
                <p className="text-xs text-pending">
                  This camera isn't on the floorplan.
                </p>
              )}
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="cam-tag">Camera</Label>
              <Select
                value={form.tag}
                onValueChange={(v) => setForm((f) => ({ ...f, tag: v }))}
              >
                <SelectTrigger
                  id="cam-tag"
                  className="w-full"
                  aria-invalid={touched && !!errors.tag}
                >
                  <SelectValue
                    placeholder={
                      planMissing
                        ? "The floorplan isn't loaded"
                        : free
                          ? `Choose a camera on ${plan.name ?? "the plan"} (${free} free)`
                          : "Every camera on the plan has a live stream"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {byZone.map(([zone, keys], i) => (
                    <SelectGroup key={zone}>
                      {i > 0 && <SelectSeparator />}
                      <SelectLabel className="font-semibold tracking-wide text-foreground uppercase">
                        {zone}
                      </SelectLabel>
                      {keys.map((k) => (
                        <SelectItem
                          key={k}
                          value={k}
                          disabled={taken.has(k)}
                          className="pl-5"
                        >
                          <span className="font-mono text-xs">{k}</span>
                          {taken.has(k) && (
                            <StatusChip tone="success">Live</StatusChip>
                          )}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              {planMissing ? (
                <p className="text-xs text-destructive">
                  {planError ?? "The floorplan is still loading."} Cameras are
                  placed on a floorplan camera; upload a plan on the Floorplan
                  page.
                </p>
              ) : touched && errors.tag ? (
                <p className="text-xs text-destructive">{errors.tag}</p>
              ) : (
                tag &&
                (node?.zone || hasFootage) && (
                  <p className="text-xs text-muted-foreground">
                    {node?.zone && <>Zone {node.zone}.</>}
                    {node?.zone && hasFootage && " "}
                    {hasFootage &&
                      "This camera already has recorded footage; the live stream joins it."}
                  </p>
                )
              )}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("frameInterval", "Index every N frames", {
              type: "number",
              min: 1,
              max: 60,
            })}
            <div className="flex items-center gap-2 self-end pb-2">
              <Switch
                id="cam-od"
                checked={form.objectDetection}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, objectDetection: v }))
                }
              />
              <Label htmlFor="cam-od">Object detection</Label>
            </div>
          </div>
          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => close(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {editing ? "Save changes" : "Add camera"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
