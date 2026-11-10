// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  Database,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { getAdapters } from "@/adapters";
import { StatusChip } from "@/components/shared/media";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { env } from "@/config/env";
import { useHealth } from "@/hooks/queries";
import { useFloorplanStore } from "@/stores/floorplan";
import { useLiveTimelineStore } from "@/stores/liveTimeline";
import {
  clampSetting,
  SETTINGS_DEFAULTS,
  SETTINGS_LIMITS,
  useSettingsStore,
  type NumericSetting,
} from "@/stores/settings";

function Panel({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Bot;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border bg-card">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <Icon className="size-4 text-brand-accent" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </header>
      <div className="grid gap-4 p-4">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

const reach = (ok: boolean | undefined, loading: boolean) =>
  loading ? (
    <StatusChip tone="neutral">Checking</StatusChip>
  ) : ok ? (
    <StatusChip tone="success">Reachable</StatusChip>
  ) : (
    <StatusChip tone="error">Unreachable</StatusChip>
  );

function Connections() {
  const health = useHealth();
  const features = useQuery({
    queryKey: ["vss", "features"],
    queryFn: () => getAdapters().vss.features(),
    staleTime: 60_000,
  });
  const f = features.data;
  return (
    <Panel icon={Bot} title="Connections">
      <Row
        label="Hermes API"
        hint={`Proxied through ${env.hermesBase}. The API key is added by the server, never by the browser.`}
      >
        {reach(health.data?.hermes, health.isLoading)}
      </Row>
      <Row
        label="VSS gateway"
        hint={`Proxied through ${env.vssBase}/manager and ${env.vssBase}/datastore.`}
      >
        {reach(health.data?.vss, health.isLoading)}
      </Row>
      <Row
        label="VSS capabilities"
        hint="Argus needs the search pipeline. Summary is optional."
      >
        <div className="flex gap-1.5">
          {features.isLoading ? (
            <StatusChip tone="neutral">Checking</StatusChip>
          ) : f ? (
            <>
              <StatusChip tone={f.search ? "success" : "error"}>
                Search
              </StatusChip>
              <StatusChip
                tone={
                  f.imageSearch === false
                    ? "pending"
                    : f.search
                      ? "success"
                      : "neutral"
                }
              >
                Image search
              </StatusChip>
              <StatusChip tone={f.summary ? "success" : "neutral"}>
                Summary
              </StatusChip>
            </>
          ) : (
            <StatusChip tone="error">Unknown</StatusChip>
          )}
        </div>
      </Row>
      {env.useMocks && (
        <p className="border border-dashed px-3 py-2 text-xs text-muted-foreground">
          Mock mode is on: Hermes and VSS are simulated with a scripted
          investigation.
        </p>
      )}
      <div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void health.refetch();
            void features.refetch();
          }}
          disabled={health.isFetching}
        >
          <RefreshCw
            className={health.isFetching ? "animate-spin" : undefined}
          />{" "}
          Check again
        </Button>
      </div>
    </Panel>
  );
}

/**
 * Number input that can be cleared and retyped: the text is kept as typed
 * and only committed (and clamped by the store) on blur or Enter.
 */
function NumberField({
  id,
  setting,
  value,
  onCommit,
}: {
  id: string;
  setting: NumericSetting;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(String(value));
  }
  const commit = () => {
    const n = text.trim() === "" ? Number.NaN : Number(text);
    // Empty or invalid text goes back to the current value.
    const next = Number.isFinite(n) ? clampSetting(setting, n) : value;
    if (next !== value) onCommit(next);
    setText(String(next));
  };
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={SETTINGS_LIMITS[setting].min}
      max={SETTINGS_LIMITS[setting].max}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      className="w-24"
    />
  );
}

function Investigation() {
  const s = useSettingsStore();
  return (
    <Panel icon={SlidersHorizontal} title="Investigation">
      <Row
        label={
          <Label htmlFor="min-score">Minimum score (of the top match)</Label>
        }
        hint="A match must score at least this fraction of the best match in its search to be shown for review, appear as a live sighting, or join the route. Lower values show more sightings but add noise."
      >
        <div className="flex items-center gap-3">
          <input
            id="min-score"
            type="range"
            min={0.3}
            max={0.95}
            step={0.05}
            value={s.minTraceScore}
            onChange={(e) => s.setMinTraceScore(Number(e.target.value))}
            className="w-40 accent-[var(--color-brand-accent)]"
          />
          <span className="w-10 text-right text-sm tabular-nums">
            {s.minTraceScore.toFixed(2)}
          </span>
        </div>
      </Row>
      <Row
        label={<Label htmlFor="limit">Matches per search</Label>}
        hint="How many candidates Argus asks VSS for. The review grid shows up to 20 of them that reach the minimum score."
      >
        <NumberField
          id="limit"
          setting="searchLimit"
          value={s.searchLimit}
          onCommit={s.setSearchLimit}
        />
      </Row>
      <Row
        label={<Label htmlFor="watch-min">Live watch time limit</Label>}
        hint="Minutes before a live watch stops by itself."
      >
        <NumberField
          id="watch-min"
          setting="watchMinutes"
          value={s.watchMinutes}
          onCommit={s.setWatchMinutes}
        />
      </Row>
      <Row
        label={<Label htmlFor="watch-idle">Stop when quiet for</Label>}
        hint="Minutes without a new live sighting before the watch stops."
      >
        <NumberField
          id="watch-idle"
          setting="watchIdleMinutes"
          value={s.watchIdleMinutes}
          onCommit={s.setWatchIdleMinutes}
        />
      </Row>
      <Row
        label={<Label htmlFor="casefile">Show the case file</Label>}
        hint="Side panel in Argus on wide screens."
      >
        <Switch
          id="casefile"
          checked={s.caseFileOpen}
          onCheckedChange={s.setCaseFileOpen}
        />
      </Row>
      <div>
        <Button
          size="sm"
          variant="ghost"
          onClick={s.reset}
          disabled={
            s.minTraceScore === SETTINGS_DEFAULTS.minTraceScore &&
            s.searchLimit === SETTINGS_DEFAULTS.searchLimit &&
            s.watchMinutes === SETTINGS_DEFAULTS.watchMinutes &&
            s.watchIdleMinutes === SETTINGS_DEFAULTS.watchIdleMinutes &&
            s.caseFileOpen === SETTINGS_DEFAULTS.caseFileOpen
          }
        >
          <RotateCcw /> Restore defaults
        </Button>
      </div>
    </Panel>
  );
}

function LocalData() {
  const [confirm, setConfirm] = useState(false);
  const resetPlan = useFloorplanStore((s) => s.reset);
  const resetSettings = useSettingsStore((s) => s.reset);

  function wipe() {
    resetPlan();
    resetSettings();
    useLiveTimelineStore.setState({ bySession: {} });
    useLiveTimelineStore.persist.clearStorage();
    toast.success("Local data cleared");
  }

  return (
    <Panel icon={Database} title="Data in this browser">
      <p className="text-sm text-muted-foreground">
        The floorplan, live search timelines and these settings are stored in
        this browser. Investigations live in Hermes; cameras, footage and search
        results live in VSS. Neither is affected here.
      </p>
      <div>
        <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>
          <Trash2 /> Clear local data
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Clear local data?"
        description="Removes the uploaded floorplan and saved live timelines, and resets settings."
        action="Clear"
        onConfirm={wipe}
        errorTitle="Couldn't clear local data"
      />
    </Panel>
  );
}

export function SettingsPage() {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 p-4 md:p-6">
      <Connections />
      <Investigation />
      <LocalData />
    </div>
  );
}
