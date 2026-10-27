import { validatePrefilterConfig } from "./prefilter-config.js";
import { readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { fingerprint, mergePatch } from "./config-patch.js";
import { parseDocument, isMap, Scalar } from "yaml";
import type { SmartCommunityDB } from "@smart-community-video/db";

/** Wrap a string so yaml emits it double-quoted (matches the hand-written monitors.yaml style). */
function quoted(value: string): Scalar {
  const s = new Scalar(value);
  s.type = Scalar.QUOTE_DOUBLE;
  return s;
}

export interface IWorkerService {
  workers: Map<string, unknown>;
  start(monitorId: string): void;
  stop(monitorId: string): Promise<void>;
}

export interface MonitorCtlParams {
  action: "start" | "stop" | "register_source" | "unregister" | "status" | "list" | "prefilter_options" | "update_pipeline" | "reload_config" | "register_prefilter_model";
  dry_run?: boolean;
  expected_revision?: string;
  candidate_hash?: string;
  monitor_id?: string;
  source_url?: string;
  name?: string;
  use_case?: string;
  video_summary_task?: string;
  pipeline_config?: Record<string, unknown>;
  /**
   * Prefilter model registry key. With `prefilter_options`, narrows the query
   * to that one model instead of listing every registered one. To put a monitor
   * ON a model, set `pipeline_config.prefilter.model` at register_source — the
   * analytics service rejects a raw `model_path` from a request.
   */
  model?: string;
  /** Absolute path to the model's IR .xml (register_prefilter_model). */
  model_path?: string;
  /** What the model does; only `detection` is supported (register_prefilter_model). */
  kind?: string;
  /** Runtime executing the model; only `openvino` is supported (register_prefilter_model). */
  backend?: string;
  /** Free text shown to agents helping a user choose (register_prefilter_model). */
  description?: string;
  webhook_url?: string;
  /**
   * Absolute path videostream-analytics should write this monitor's data to.
   * Convention: <data_dir>/latest.jpg, <data_dir>/recordings/<YYYY-MM-DD>/,
   *             <data_dir>/motion_events/<YYYY-MM-DD>/.
   * MCP server's storage cleaner relies on this layout to safely purge old day-folders.
   * Required for register_source.
   */
  data_dir?: string;
  /**
   * Keepalive watchdog config forwarded to analytics at register_source as
   * `pipeline.keepalive`. When provided (and `pipeline_config` does not already
   * declare its own `keepalive` block), it is injected so the analytics-side
   * watchdog is armed. The MCP server is responsible for driving the matching
   * POST /sources/{id}/keepalive heartbeat loop. See VSA API §3.8.
   */
  keepalive?: { enabled: boolean; timeout_seconds: number; check_interval_seconds: number };
  /**
   * When true, mirror the mutation to `monitors_path` on disk (comment-preserving
   * via yaml.Document): register_source → write the monitor's declaration block,
   * unregister → delete it, stop → flip its `enabled` to false, start → flip it
   * back to true. Requires `monitors_path` to be set. Failure writing
   * does NOT fail the whole call — it is surfaced as `monitors_yaml: "skipped"`
   * plus a warning, so the in-memory + DB registration still stands. Mirrors the
   * `persist` semantics of use_case_register writing back to config.yaml.
   */
  persist?: boolean;
  /**
   * Absolute path to the monitors.yaml the server was booted from (--monitors).
   * Injected by the tool layer from `config.monitorsPath`. Only consulted when
   * `persist` is true.
   */
  monitors_path?: string;
}

/** Fields mirrored back to monitors.yaml — matches MonitorDeclaration in monitors-compose.ts. */
interface PersistOutcome {
  monitors_yaml?: "written" | "removed" | "enabled" | "disabled" | "skipped";
  persist_warnings?: string[];
}

/**
 * Mirror a monitor mutation to `monitorsPath` on disk. Uses yaml.Document API so
 * comments and field ordering are preserved. `decl === null` → deleteIn (unregister).
 * Non-throwing: on any error, records a warning and returns "skipped". Only the
 * fields consumed by applyMonitorConfig on restart are written — video_summary_task
 * / data_dir / webhook_url / keepalive are all derived from config at bootstrap and
 * must NOT be persisted here or they would drift.
 */
function persistMonitorEntry(
  monitorsPath: string | undefined,
  monitorId: string,
  decl: Record<string, unknown> | null,
): PersistOutcome {
  if (!monitorsPath) {
    return {
      monitors_yaml: "skipped",
      persist_warnings: ["persist requested but monitors_path is unset (server booted without --monitors?); skipped"],
    };
  }
  try {
    const raw = readFileSync(monitorsPath, "utf-8");
    const doc = parseDocument(raw);
    const existing = doc.get("monitors");
    if (!existing || !isMap(existing)) {
      const monitors = doc.createNode({});
      if (isMap(monitors)) monitors.flow = false;
      doc.set("monitors", monitors);
    } else {
      existing.flow = false;
    }
    if (decl === null) {
      doc.deleteIn(["monitors", monitorId]);
    } else {
      // Emit `name` double-quoted to match the built-in monitors.yaml entries.
      const node = typeof decl.name === "string" ? { ...decl, name: quoted(decl.name) } : decl;
      doc.setIn(["monitors", monitorId], node);
    }
    writeFileSync(monitorsPath, doc.toString(), "utf-8");
    return { monitors_yaml: decl === null ? "removed" : "written" };
  } catch (err: any) {
    return {
      monitors_yaml: "skipped",
      persist_warnings: [`persist to ${monitorsPath} failed: ${err.message}`],
    };
  }
}

/**
 * Flip the `enabled` field of an existing monitors.yaml entry (comment-preserving).
 * Used by stop/start with persist=true: stop → enabled: false, start → enabled: true.
 * No new schema field is introduced — if the entry has no explicit `enabled` key
 * (absent means enabled at bootstrap), the key is added with the new value.
 * Entry absent from the file → "skipped" + warning, never creates an entry.
 */
function persistMonitorEnabled(
  monitorsPath: string | undefined,
  monitorId: string,
  enabled: boolean,
): PersistOutcome {
  if (!monitorsPath) {
    return {
      monitors_yaml: "skipped",
      persist_warnings: ["persist requested but monitors_path is unset (server booted without --monitors?); skipped"],
    };
  }
  try {
    const raw = readFileSync(monitorsPath, "utf-8");
    const doc = parseDocument(raw);
    if (!doc.hasIn(["monitors", monitorId])) {
      return {
        monitors_yaml: "skipped",
        persist_warnings: [`monitor "${monitorId}" has no entry in ${monitorsPath}; nothing to flip`],
      };
    }
    doc.setIn(["monitors", monitorId, "enabled"], enabled);
    writeFileSync(monitorsPath, doc.toString(), "utf-8");
    return { monitors_yaml: enabled ? "enabled" : "disabled" };
  } catch (err: any) {
    return {
      monitors_yaml: "skipped",
      persist_warnings: [`persist to ${monitorsPath} failed: ${err.message}`],
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function analyticsSourceExists(analyticsUrl: string, monitorId: string): Promise<boolean | null> {
  try {
    const resp = await fetch(`${analyticsUrl}/sources/${monitorId}/status`, { signal: AbortSignal.timeout(8_000) });
    if (resp.status === 200) return true;
    if (resp.status === 404) return false;
    throw new Error(`analytics GET /sources/${monitorId}/status returned HTTP ${resp.status}`);
  } catch (err: any) {
    if (err.message?.includes("returned HTTP")) throw err;
    throw new Error(`videostream-analytics (${analyticsUrl}) unreachable: ${err.message}`);
  }
}

/**
 * Fetch the selectable prefilter models from videostream-analytics. Returns the
 * raw JSON: `{ enabled, default_model, supported_kinds, supported_backends,
 * available_devices, models, rejected, ... }`. `models[].name` is what
 * `pipeline_config.prefilter.model` accepts; `rejected` lists registered
 * entries that cannot be used, with the reason. `labels_source` on each model
 * is `embedded | fallback_coco | unavailable` — only `embedded` names are
 * authoritative; otherwise the list is a COCO guess the caller must confirm.
 *
 * With `model`, returns that one entry's detail instead (404 if it is not a
 * usable registered model).
 */
async function analyticsPrefilterOptions(analyticsUrl: string, model?: string): Promise<unknown> {
  const query = model ? `?model=${encodeURIComponent(model)}` : "";
  const resp = await fetch(`${analyticsUrl}/capabilities/prefilter${query}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`analytics GET /capabilities/prefilter${query} failed HTTP ${resp.status}: ${t.slice(0, 200)}`);
  }
  return resp.json();
}

/**
 * Ask analytics to re-read its configuration file and swap it in without a
 * restart (POST /config/reload). Running sources are untouched; new
 * registrations and capability queries see the reloaded registry. Returns the
 * service's summary: { status, path, models, rejected }.
 */
async function analyticsReloadConfig(analyticsUrl: string): Promise<unknown> {
  const resp = await fetch(`${analyticsUrl}/config/reload`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`analytics POST /config/reload failed HTTP ${resp.status}: ${t.slice(0, 300)}`);
  }
  return resp.json();
}

/**
 * Register a model into VSA's prefilter registry by editing its live
 * configuration file (identity-mounted read-write into this container), then
 * hot-reloading VSA and confirming through /capabilities/prefilter. The edit
 * is written in place — a temp-file+rename would swap the host inode out from
 * under the single-file bind mount and the change would never reach VSA.
 *
 * Idempotent: an existing entry with identical kind/backend/model_path is a
 * no-op; a conflicting entry is an error (the user must resolve it — the
 * registry entry may be deliberate operator config).
 */
async function registerPrefilterModel(analyticsUrl: string, params: MonitorCtlParams): Promise<unknown> {
  const name = params.model?.trim();
  if (!name) throw new Error("model (the registry key) is required for register_prefilter_model");
  const modelPath = params.model_path?.trim();
  if (!modelPath) throw new Error("model_path is required for register_prefilter_model");
  if (!modelPath.startsWith("/")) throw new Error("model_path must be an absolute path");
  const kind = params.kind ?? "detection";
  const backend = params.backend ?? "openvino";

  const configPath = process.env.VIDEOSTREAM_CONFIG_FILE;
  if (!configPath) {
    throw new Error("VIDEOSTREAM_CONFIG_FILE is not set on the MCP server; cannot edit the VSA configuration");
  }
  let doc;
  try {
    doc = parseDocument(readFileSync(configPath, "utf-8"));
  } catch (err: any) {
    throw new Error(`cannot read VSA config at ${configPath}: ${err.message} — run videostream-analytics/setup_vsa.sh first`);
  }
  if (!doc.hasIn(["prefilter_models"])) doc.setIn(["prefilter_models"], doc.createNode({}));

  const existing = doc.getIn(["prefilter_models", name]);
  const alreadyExisted = isMap(existing);
  if (alreadyExisted) {
    const same =
      String(existing.get("model_path")) === modelPath &&
      String(existing.get("kind") ?? "detection") === kind &&
      String(existing.get("backend") ?? "openvino") === backend;
    if (!same) {
      throw new Error(
        `prefilter model "${name}" is already registered with different settings ` +
        `(model_path: ${String(existing.get("model_path"))}); edit the VSA config by hand or pick another name`,
      );
    }
  } else {
    doc.setIn(["prefilter_models", name], doc.createNode({
      kind,
      backend,
      model_path: modelPath,
      ...(params.description ? { description: params.description } : {}),
    }));
    writeFileSync(configPath, doc.toString(), "utf-8");
  }

  // VSA's config watcher would pick the edit up within seconds; reload
  // explicitly so this call can confirm the outcome instead of "probably".
  await analyticsReloadConfig(analyticsUrl);
  const report = (await analyticsPrefilterOptions(analyticsUrl)) as any;
  const usable = (report.models ?? []).find((m: any) => m.name === name);
  if (usable) {
    return {
      model: name,
      status: "selectable",
      entry: usable,
      config_file: configPath,
      ...(alreadyExisted ? { note: "identical entry was already registered" } : {}),
    };
  }
  const rejected = (report.rejected ?? []).find((r: any) => r.name === name);
  if (rejected) {
    return { model: name, status: "rejected", reason: rejected.reason, config_file: configPath };
  }
  // Written but absent from the report: VSA is reading a different file than
  // the one just edited. Most often the host file was replaced (atomic save in
  // an editor, `sed -i`) after this container started, so its single-file mount
  // still points at the old inode and the write landed on an orphan; otherwise
  // VIDEOSTREAM_CONFIG_FILE differs between the two services.
  return {
    model: name,
    status: "written_not_listed",
    config_file: configPath,
    hint: "VSA is not reading the file just edited. If the config was recently saved with an " +
      "editor or `sed -i`, restart the MCP server so it re-mounts the current file; " +
      "otherwise check that VIDEOSTREAM_CONFIG_FILE is the same on both services",
  };
}

async function analyticsDelete(analyticsUrl: string, monitorId: string): Promise<void> {
  const resp = await fetch(`${analyticsUrl}/sources/${monitorId}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok && resp.status !== 404) {
    const t = await resp.text().catch(() => "");
    throw new Error(`analytics DELETE /sources/${monitorId} failed HTTP ${resp.status}: ${t.slice(0, 200)}`);
  }
}

async function analyticsRegister(
  analyticsUrl: string,
  monitorId: string,
  sourceUrl: string,
  webhookUrl: string,
  dataDir: string,
  pipelineConfig?: Record<string, unknown>,
  keepalive?: MonitorCtlParams["keepalive"]
): Promise<void> {
  const pipeline: Record<string, unknown> = pipelineConfig
    ? { ...pipelineConfig }
    : {
        motion: { enabled: true },
        prefilter: { enabled: false },
        recording: { enabled: true, interval_seconds: 60 },
      };

  // Arm the analytics-side keepalive watchdog unless the monitor already
  // declares its own keepalive block (per-monitor override wins).
  if (keepalive && !("keepalive" in pipeline)) {
    pipeline.keepalive = {
      enabled: keepalive.enabled,
      timeout_seconds: keepalive.timeout_seconds,
      check_interval_seconds: keepalive.check_interval_seconds,
    };
  }

  const resp = await fetch(`${analyticsUrl}/register_source`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_id: monitorId,
      source_url: sourceUrl,
      webhook_url: webhookUrl,
      data_dir: dataDir,    // analytics writes latest.jpg + recordings/<date>/ + motion_events/<date>/ here
      pipeline,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`analytics register_source failed HTTP ${resp.status}: ${t.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Manage monitor lifecycle as an atomic operation across DB, videostream-analytics, and video-worker.
 */
export async function monitorCtl(
  db: SmartCommunityDB,
  analyticsBaseUrl: string,
  workerService: IWorkerService,
  params: MonitorCtlParams
): Promise<unknown> {
  const analyticsUrl = analyticsBaseUrl;

  switch (params.action) {
    // -----------------------------------------------------------------------
    case "list": {
      const monitors = db.listMonitors();
      try {
        const resp = await fetch(`${analyticsUrl}/sources`, { signal: AbortSignal.timeout(5000) });
        if (resp.ok) {
          const live = (await resp.json()) as any[];
          const liveById = Object.fromEntries(live.map((s: any) => [s.source_id, s]));
          return monitors.map((m) => ({ ...m, analyticsReachable: true, analyticsStatus: liveById[m.id]?.status ?? "unknown" }));
        }
        return monitors.map((m) => ({ ...m, analyticsReachable: false, analyticsStatus: null, analyticsError: `HTTP ${resp.status}` }));
      } catch (err: any) {
        return monitors.map((m) => ({ ...m, analyticsReachable: false, analyticsStatus: null, analyticsError: err?.message ?? "unreachable" }));
      }
    }

    // -----------------------------------------------------------------------
    case "update_pipeline": {
      return updatePipeline(db, analyticsUrl, params);
    }
    case "register_source": {
      if (!params.monitor_id) throw new Error("monitor_id is required for register_source");
      if (!params.source_url) throw new Error("source_url is required for register_source");
      if (!params.video_summary_task)
        throw new Error("video_summary_task is required for register_source");
      if (!params.data_dir)
        throw new Error("data_dir is required for register_source (where analytics should write latest.jpg / recordings/ / motion_events/)");

      validatePrefilterConfig(params.pipeline_config);
      const monitorId = params.monitor_id;
      // Guard against conflating the monitor id with the VLM task name — a common
      // agent mistake. Monitor ids follow the cam_<use_case> convention;
      // <use_case>_monitor is the video_summary_task name, not a monitor id.
      if (monitorId === params.video_summary_task) {
        throw new Error(
          `monitor_id "${monitorId}" must not equal the video_summary_task name ("${params.video_summary_task}"). ` +
          `Use the cam_<use_case> convention (e.g. cam_${params.use_case ?? "<use_case>"}).`,
        );
      }
      if (!params.webhook_url) throw new Error("webhook_url missing for register_source — it must be derived from config eventsWebhook.port by the caller (not supplied by the agent)");
      const webhookUrl = params.webhook_url;
      const dataDir = params.data_dir;

      const dbExists = !!db.getMonitor(monitorId);
      const analyticsExists = await analyticsSourceExists(analyticsUrl, monitorId); // throws if unreachable
      const workerRunning = workerService.workers.has(monitorId);

      // use_case consistency check (only when DB record exists and param provided)
      if (dbExists && params.use_case) {
        const existing = db.getMonitor(monitorId)!;
        if (existing.useCase !== params.use_case) {
          throw new Error(
            `use_case mismatch: DB="${existing.useCase}", got="${params.use_case}". Unregister first to change use_case.`
          );
        }
      }

      // ✅/✅/✅ — all running, idempotent return
      if (dbExists && analyticsExists && workerRunning) {
        const existing = db.getMonitor(monitorId)!;
        if (existing.sourceUrl === params.source_url && existing.videoSummaryTask === params.video_summary_task) {
          if (params.pipeline_config) return updatePipeline(db, analyticsUrl, params, true);
          return { success: true, monitor_id: monitorId, status: "already_running" };
        }
      }

      // Stop worker if running (graceful, waits for in-flight poll)
      if (workerRunning) {
        await workerService.stop(monitorId);
      }

      // Delete from analytics if it exists there (ensures clean re-register)
      if (analyticsExists) {
        await analyticsDelete(analyticsUrl, monitorId);
      }

      // DB: insert or update
      if (dbExists) {
        db.updateMonitor(monitorId, {
          sourceUrl: params.source_url,
          ...(params.name ? { name: params.name } : {}),
          ...(params.use_case ? { useCase: params.use_case } : {}),
          videoSummaryTask: params.video_summary_task,
          status: "offline",
        });
      } else {
        db.createMonitor({
          id: monitorId,
          name: params.name ?? monitorId,
          sourceUrl: params.source_url,
          status: "offline",
          useCase: params.use_case ?? "default",
          videoSummaryTask: params.video_summary_task,
        });
      }

      // Register with analytics (starts stream processing immediately)
      await analyticsRegister(analyticsUrl, monitorId, params.source_url, webhookUrl, dataDir, params.pipeline_config, params.keepalive);
      db.updateMonitorStatus(monitorId, "online");

      // Start video-worker task poller
      workerService.start(monitorId);

      // Optionally mirror the declaration back to monitors.yaml so a restart's
      // autoRegisterMonitors re-runs the full pipeline (and pipeline_config —
      // which is NOT stored in the monitors table — survives).
      let persistOutcome: PersistOutcome = {};
      if (params.persist) {
        persistOutcome = persistMonitorEntry(params.monitors_path, monitorId, {
          enabled: true,
          name: params.name ?? monitorId,
          source_url: params.source_url,
          use_case: params.use_case ?? "default",
          ...(params.pipeline_config ? { pipeline_config: params.pipeline_config } : {}),
        });
      }

      return { success: true, monitor_id: monitorId, ...persistOutcome };
    }

    // -----------------------------------------------------------------------
    case "unregister": {
      if (!params.monitor_id) throw new Error("monitor_id is required for unregister");
      const monitorId = params.monitor_id;

      await workerService.stop(monitorId);
      await fetch(`${analyticsUrl}/sources/${monitorId}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(10_000),
      }).catch(() => { /* non-fatal: DB deletion proceeds regardless */ });
      db.deleteMonitor(monitorId);

      let persistOutcome: PersistOutcome = {};
      if (params.persist) {
        persistOutcome = persistMonitorEntry(params.monitors_path, monitorId, null);
      }

      return { success: true, monitor_id: monitorId, ...persistOutcome };
    }

    // -----------------------------------------------------------------------
    case "start": {
      if (!params.monitor_id) throw new Error("monitor_id is required for start");
      const monitorId = params.monitor_id;
      await fetch(`${analyticsUrl}/sources/${monitorId}/resume`, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {});
      db.updateMonitorStatus(monitorId, "online");
      workerService.start(monitorId);

      let persistOutcome: PersistOutcome = {};
      if (params.persist) {
        persistOutcome = persistMonitorEnabled(params.monitors_path, monitorId, true);
      }
      return { success: true, monitor_id: monitorId, status: "online", ...persistOutcome };
    }

    // -----------------------------------------------------------------------
    case "stop": {
      if (!params.monitor_id) throw new Error("monitor_id is required for stop");
      const monitorId = params.monitor_id;
      await workerService.stop(monitorId);
      await fetch(`${analyticsUrl}/sources/${monitorId}/pause`, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {});
      db.updateMonitorStatus(monitorId, "offline");

      let persistOutcome: PersistOutcome = {};
      if (params.persist) {
        persistOutcome = persistMonitorEnabled(params.monitors_path, monitorId, false);
      }
      return { success: true, monitor_id: monitorId, status: "offline", ...persistOutcome };
    }

    // -----------------------------------------------------------------------
    case "status": {
      if (!params.monitor_id) throw new Error("monitor_id is required for status");
      const monitor = db.getMonitor(params.monitor_id);
      if (!monitor) throw new Error(`Monitor not found: ${params.monitor_id}`);
      try {
        const resp = await fetch(`${analyticsUrl}/sources/${params.monitor_id}/status`, { signal: AbortSignal.timeout(5000) });
        if (!resp.ok) return { ...monitor, analyticsReachable: false, analyticsStatus: null, analyticsError: `HTTP ${resp.status}` };
        // The effective pipeline (defaults←source merge) is what the monitor
        // actually runs — e.g. whether a monitor that never configured
        // `prefilter` is filtering, and with which model/classes. Older VSA
        // builds lack the endpoint; absence is not an error.
        let analyticsPipeline: unknown = null;
        try {
          const p = await fetch(`${analyticsUrl}/sources/${params.monitor_id}/pipeline`, { signal: AbortSignal.timeout(5000) });
          if (p.ok) analyticsPipeline = (await p.json()).pipeline ?? null;
        } catch { /* older VSA without /pipeline — status alone is fine */ }
        return { ...monitor, analyticsReachable: true, analyticsStatus: await resp.json(), analyticsPipeline };
      } catch (err: any) {
        return { ...monitor, analyticsReachable: false, analyticsStatus: null, analyticsError: err?.message ?? "unreachable" };
      }
    }

    // -----------------------------------------------------------------------
    case "prefilter_options": {
      // Read-only capability query — no monitor_id / DB / worker involvement.
      return await analyticsPrefilterOptions(analyticsUrl, params.model);
    }

    // -----------------------------------------------------------------------
    case "reload_config": {
      // Hot-swap the analytics configuration without a restart — used after
      // the operator edits the VSA config file (e.g. adds a prefilter model).
      return await analyticsReloadConfig(analyticsUrl);
    }

    // -----------------------------------------------------------------------
    case "register_prefilter_model": {
      // No monitor_id / DB / worker involvement: edits the VSA config file,
      // reloads, and confirms via the capabilities report.
      return await registerPrefilterModel(analyticsUrl, params);
    }

    // -----------------------------------------------------------------------
    default:
      throw new Error(`Unknown action: ${(params as any).action}`);
  }
}

/**
 * Detach a single monitor WITHOUT deleting its DB history — the "stop stream +
 * strip from monitors.yaml, keep history" primitive. Steps: stop worker →
 * delete VSA source (non-fatal) → mark the DB row offline (row +
 * alerts/tasks/events/recordings kept) → strip the monitor from monitors.yaml
 * when `persist`. Unlike `monitorCtl action=unregister`, it never calls
 * db.deleteMonitor, so it won't trip FK constraints or destroy history.
 */
export async function detachMonitor(
  db: SmartCommunityDB,
  analyticsBaseUrl: string,
  workerService: IWorkerService,
  params: { monitor_id: string; monitors_path?: string; persist?: boolean },
): Promise<{
  monitor_id: string;
  detached: boolean;
  analytics_source: "deleted_or_absent" | "failed";
  analytics_error?: string;
} & PersistOutcome> {
  const monitorId = params.monitor_id;
  if (workerService.workers.has(monitorId)) {
    await workerService.stop(monitorId);
  }
  let analyticsError: string | undefined;
  await analyticsDelete(analyticsBaseUrl, monitorId).catch((err: unknown) => {
    analyticsError = err instanceof Error ? err.message : String(err);
  });
  if (db.getMonitor(monitorId)) {
    db.updateMonitorStatus(monitorId, "offline");
  }
  let persistOutcome: PersistOutcome = {};
  if (params.persist) {
    persistOutcome = persistMonitorEntry(params.monitors_path, monitorId, null);
  }
  return {
    monitor_id: monitorId,
    detached: true,
    analytics_source: analyticsError ? "failed" : "deleted_or_absent",
    ...(analyticsError ? { analytics_error: analyticsError } : {}),
    ...persistOutcome,
  };
}


const pipelineLocks = new Map<string, Promise<void>>();
async function updatePipeline(db: SmartCommunityDB, url: string, params: MonitorCtlParams, approvedUpsert = false): Promise<unknown> {
  const id = params.monitor_id;
  if (!id) throw new Error("monitor_id is required for update_pipeline");
  const lockKey = `${url}/${id}`;
  const previous = pipelineLocks.get(lockKey) ?? Promise.resolve();
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => hold); pipelineLocks.set(lockKey, tail);
  await previous;
  const started = performance.now();
  try {
    validatePrefilterConfig(params.pipeline_config);
    const monitor = db.getMonitor(id);
    if (!monitor) throw new Error(`Monitor not found: ${id}`);
    const response = await fetch(`${url}/sources/${encodeURIComponent(id)}/status`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`cannot read running pipeline: HTTP ${response.status}`);
    const live: any = await response.json();
    if (!live.pipeline_config) throw new Error("analytics does not expose pipeline_config; upgrade analytics before updating");
    let raw: string | undefined, declaration: any = {};
    if (params.monitors_path) {
      raw = readFileSync(params.monitors_path, "utf8");
      const doc = parseDocument(raw); if (doc.errors.length) throw new Error("invalid monitors YAML");
      declaration = doc.toJS()?.monitors?.[id] ?? {};
    }
    if (params.persist && !params.monitors_path) throw new Error("pipeline persistence requires --monitors");
    const before = live.pipeline_config;
    const after = mergePatch(before, params.pipeline_config ?? {});
    if (after.roi?.enabled && !after.prefilter?.enabled) throw new Error("ROI requires prefilter");
    validatePrefilterConfig(after);
    const validation = await fetch(`${url}/sources/${encodeURIComponent(id)}/pipeline/validate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipeline: { prefilter: after.prefilter, roi: after.roi } }), signal: AbortSignal.timeout(8000),
    });
    if (!validation.ok) throw new Error(`pipeline validation failed: HTTP ${validation.status} ${await validation.text()}`);
    const revision = fingerprint({ before, declaration });
    const hash = fingerprint({ revision, patch: params.pipeline_config ?? {} });
    const common = { monitor_id: id, revision, candidate_hash: hash, diff: { before, after } };
    if (params.dry_run) return { ...common, success: true, dry_run: true, total_ms: performance.now() - started };
    if (!approvedUpsert && (params.expected_revision !== revision || params.candidate_hash !== hash)) throw new Error("revision/candidate mismatch; preview update_pipeline and confirm the exact difference");
    const override = mergePatch(declaration.pipeline_config ?? {}, params.pipeline_config ?? {});
    for (const key of Object.keys(params.pipeline_config ?? {})) {
      if (!["motion", "segment", "prefilter", "roi", "recording", "health"].includes(key) && fingerprint(before[key]) !== fingerprint(after[key])) {
        throw new Error(`pipeline update does not support changing ${key}; re-register the source explicitly`);
      }
    }
    const changed = fingerprint(before) !== fingerprint(after);
    let nextYaml: string | undefined;
    if (params.persist) {
      const doc = parseDocument(raw!);
      doc.setIn(["monitors", id], { ...declaration, enabled: declaration.enabled ?? true, name: params.name ?? declaration.name ?? monitor.name,
        source_url: monitor.sourceUrl, use_case: monitor.useCase, pipeline_config: override });
      nextYaml = doc.toString();
    }
    const verifyPrefilter = (status: any, pipeline: any) => {
      if (pipeline.prefilter?.enabled && status.prefilter_status?.status !== "ready") {
        throw new Error(`prefilter is not ready: ${status.prefilter_status?.error ?? "analytics did not report a ready detector"}`);
      }
    };
    const put = async (pipeline: Record<string, any>) => {
      const resp = await fetch(`${url}/sources/${encodeURIComponent(id)}/pipeline`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pipeline }), signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) throw new Error(`pipeline update failed: HTTP ${resp.status}`);
    };
    try {
      if (changed) {
        const delta = Object.fromEntries(Object.entries(params.pipeline_config!).filter(([key]) => ["motion", "segment", "prefilter", "roi", "recording", "health"].includes(key)));
        await put(delta);
        const check = await fetch(`${url}/sources/${encodeURIComponent(id)}/status`, { signal: AbortSignal.timeout(5000) });
        if (!check.ok) throw new Error(`pipeline verification failed: HTTP ${check.status}`);
        const actual: any = await check.json();
        if (!actual.pipeline_config || fingerprint(mergePatch(actual.pipeline_config, delta)) !== fingerprint(actual.pipeline_config)) {
          throw new Error("running pipeline did not apply requested changes");
        }
        verifyPrefilter(actual, after);
      }
      if (!changed) verifyPrefilter(live, after);
      if (nextYaml !== undefined && nextYaml !== raw) {
        if (readFileSync(params.monitors_path!, "utf8") !== raw) throw new Error("monitors YAML changed during update");
        const temporary = `${params.monitors_path}.${process.pid}.tmp`;
        try { writeFileSync(temporary, nextYaml); renameSync(temporary, params.monitors_path!); }
        finally { rmSync(temporary, { force: true }); }
      }
    } catch (error: any) {
      if (changed) {
        try { const restorable = Object.fromEntries(Object.entries(before).filter(([key]) => ["motion", "segment", "prefilter", "roi", "recording", "health"].includes(key))); await put(restorable);
          const restored = await fetch(`${url}/sources/${encodeURIComponent(id)}/status`, { signal: AbortSignal.timeout(5000) });
          if (!restored.ok) throw new Error(`pipeline restore verification failed: HTTP ${restored.status}`);
          const actual: any = await restored.json();
          if (!actual.pipeline_config || fingerprint(mergePatch(actual.pipeline_config, restorable)) !== fingerprint(actual.pipeline_config)) throw new Error("restored pipeline does not match original configuration");
          verifyPrefilter(actual, before);
        }
        catch (restore: any) { return { ...common, success: false, degraded: true, error: error.message, restore_error: restore.message }; }
      }
      throw error;
    }
    return { ...common, success: true, status: changed ? "updated" : "unchanged", monitors_yaml: params.persist ? "written" : "skipped", total_ms: performance.now() - started };
  } finally { release(); if (pipelineLocks.get(lockKey) === tail) pipelineLocks.delete(lockKey); }
}
