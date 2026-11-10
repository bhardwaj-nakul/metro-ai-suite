// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { VssHit } from "@/adapters/vss/types";
import { hitCameraLabel, hitMatchesRef } from "@/lib/hits";
import { confidence } from "@/protocol/directives";
import { formatClock } from "@/lib/time";
import type { TraceStop } from "@/stores/case";
import type { ReportContent } from "./content";
import { cameraZone, useFloorplanStore } from "@/stores/floorplan";
import { stopNumbers } from "@/features/map/route";

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * One-item-per-line textarea. The raw text stays local so spaces and blank
 * lines can be typed; the cleaned list is sent up on every change and the
 * text is tidied on blur. A new list from outside (another draft) replaces it.
 */
function LinesTextarea({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [text, setText] = useState(() => value.join("\n"));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (!sameList(lines(text), value)) setText(value.join("\n"));
  }
  return (
    <Textarea
      id={id}
      rows={4}
      className="font-prose"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const next = lines(e.target.value);
        if (!sameList(next, value)) onChange(next);
      }}
      onBlur={() => setText(value.join("\n"))}
    />
  );
}

/** Editable view of a vsg-report before it becomes a PDF. */
export function ReportEditor({
  value,
  onChange,
  stops,
}: {
  value: ReportContent;
  onChange: (next: ReportContent) => void;
  stops: TraceStop[];
}) {
  const plan = useFloorplanStore((s) => s.plan);
  const numbers = useMemo(() => stopNumbers(stops, plan), [stops, plan]);
  const set = <K extends keyof ReportContent>(k: K, v: ReportContent[K]) =>
    onChange({ ...value, [k]: v });
  const refersTo = (hit: VssHit) => (t: { ref?: string }) =>
    !!t.ref && hitMatchesRef(hit, t.ref);
  const noteFor = (hit: VssHit) =>
    value.timeline.find(refersTo(hit))?.note ?? "";
  const setNote = (hit: VssHit, note: string) => {
    const rest = value.timeline.filter((t) => !refersTo(hit)(t));
    set("timeline", note ? [...rest, { ref: hit.matchId, note }] : rest);
  };

  return (
    <div className="grid gap-3 text-sm">
      <div className="grid gap-1.5">
        <Label htmlFor="report-title">Title</Label>
        <Input
          id="report-title"
          value={value.title}
          maxLength={160}
          onChange={(e) => set("title", e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label>Confidence</Label>
          <Select
            value={value.confidence}
            onValueChange={(v) =>
              set("confidence", v as ReportContent["confidence"])
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {confidence.options.map((c) => (
                <SelectItem key={c} value={c} className="capitalize">
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="report-summary">Summary</Label>
        <Textarea
          id="report-summary"
          rows={4}
          className="font-prose"
          value={value.summary}
          onChange={(e) => set("summary", e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="report-subject">Subject description</Label>
        <Textarea
          id="report-subject"
          rows={2}
          className="font-prose"
          value={value.subject}
          onChange={(e) => set("subject", e.target.value)}
        />
      </div>
      {stops.length > 0 && (
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Sighting notes</legend>
          {stops.map((s) => (
            <div
              key={s.hit.matchId + s.order}
              className="flex items-center gap-2"
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-track text-[0.6875rem] font-bold text-white">
                {numbers.get(s.order) ?? "–"}
              </span>
              <span className="w-40 shrink-0 truncate text-xs text-muted-foreground">
                {formatClock(s.at)} {hitCameraLabel(s.hit)}
                {cameraZone(s.hit.cameraTag) &&
                  `, ${cameraZone(s.hit.cameraTag)}`}
              </span>
              <Input
                aria-label={`Note for sighting ${s.order}`}
                className="h-8 text-xs"
                value={noteFor(s.hit)}
                onChange={(e) => setNote(s.hit, e.target.value)}
              />
            </div>
          ))}
        </fieldset>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="report-obs">Observations, one per line</Label>
          <LinesTextarea
            id="report-obs"
            value={value.observations}
            onChange={(v) => set("observations", v)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="report-actions">
            Recommended actions, one per line
          </Label>
          <LinesTextarea
            id="report-actions"
            value={value.actions}
            onChange={(v) => set("actions", v)}
          />
        </div>
      </div>
    </div>
  );
}
