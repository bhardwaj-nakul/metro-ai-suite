// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { toast } from "sonner";
import { create } from "zustand";
import { getAdapters } from "@/adapters";
import { HermesError } from "@/adapters/hermes/types";
import type { UploadedImage } from "@/adapters/vss/types";
import { env } from "@/config/env";
import { toDatastorePath } from "@/lib/urls";
import { uid } from "@/lib/utils";
import {
  buildSearchInput,
  IMAGE_ONLY_PROMPT,
  serializeFeedback,
} from "@/protocol/feedback";
import { groundingForRun } from "@/protocol/grounding";
import { buildInstructions } from "@/protocol/instructions";
import { extractDirectives } from "@/protocol/parser";
import { selectHasLiveCamera, useCamerasStore } from "./cameras";
import { splitVerdicts, type Review, type Verdict } from "./case";
import {
  cameraZone,
  freeFloorplanCameras,
  loadDefaultFloorplan,
} from "./floorplan";
import {
  applyRunEvent,
  classifyPrompt,
  confirmsSightings,
  describeFeedback,
  instructionContext,
  latestDirective,
  newAgentTurn,
  phaseFromTurns,
  reviewsFromTurns,
  routeOf,
  runningPhase,
  settleAfter,
  splitReportPrompt,
  subjectImageOf,
  subjectTextOf,
  turnsFromMessages,
  type AgentTurn,
  type InvestigationPhase,
  type OperatorTurn,
  type Turn,
} from "./investigation.logic";
import { useSettingsStore } from "./settings";
import { sessionSightings, useLiveTimelineStore } from "./liveTimeline";
import { isWatchActive, useWatchStore, type WatchSubject } from "./watch";

export type {
  AgentTurn,
  InvestigationPhase,
  OperatorTurn,
  ToolCallView,
  Turn,
} from "./investigation.logic";

export interface SearchOptions {
  image?: UploadedImage;
}

interface InvestigationState {
  sessionId?: string;
  title?: string;
  turns: Turn[];
  phase: InvestigationPhase;
  activeRunId?: string;
  busy: boolean;
  stopping: boolean;
  loadingSession: boolean;
  /** Bumped whenever a run settles, so history lists can refetch. */
  revision: number;
  /** Review state per grid, keyed by the agent turn that showed it. */
  reviews: Record<string, Review>;

  send: (text: string, opts?: SearchOptions) => Promise<void>;
  /** Change the latest grid's working verdicts (earlier grids are read-only). */
  setVerdicts: (turnId: string, verdicts: Record<string, Verdict>) => void;
  /**
   * Send the latest grid's verdicts (every shown match: confirm or reject).
   * They replace that grid's earlier verdicts.
   */
  submitReview: (
    turnId: string,
    verdicts: Record<string, Verdict>,
    opts: {
      queryId?: string;
      /** Human-readable clip label per ref, so the model can ground "m3". */
      labels?: Record<string, string>;
    },
  ) => Promise<void>;
  retry: (agentTurnId: string) => Promise<void>;
  /** Read an agent turn's search result from the transcript again. */
  reground: (agentTurnId: string) => Promise<void>;
  /** Operator asked to watch the live cameras for the current subject. */
  startWatch: () => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
  resume: (sessionId: string) => Promise<void>;
}

let controller: AbortController | undefined;
/** Bumped by every resume and reset; a stale resume response is dropped. */
let loadToken = 0;

/**
 * The run this tab is following, kept in sessionStorage so a refresh can
 * reattach to it instead of losing it (and starting a second run).
 */
interface ActiveRun {
  sessionId: string;
  runId: string;
  op: OperatorTurn;
}

const ACTIVE_RUN_KEY = "vsg-active-run";
/** Run statuses after which there is nothing left to follow. */
const RUN_ENDED = new Set(["completed", "failed", "cancelled", "interrupted"]);

function readActiveRun(): ActiveRun | undefined {
  const raw = sessionStorage.getItem(ACTIVE_RUN_KEY);
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as Partial<ActiveRun> | null;
    if (
      typeof v?.sessionId === "string" &&
      typeof v.runId === "string" &&
      v.op?.role === "operator" &&
      typeof v.op.input === "string"
    )
      return v as ActiveRun;
  } catch {
    // Not JSON: dropped below.
  }
  sessionStorage.removeItem(ACTIVE_RUN_KEY);
  return undefined;
}

function forgetActiveRun(runId: string) {
  if (readActiveRun()?.runId === runId)
    sessionStorage.removeItem(ACTIVE_RUN_KEY);
}

const errorText = (e: unknown) => (e as Error).message || "Request failed.";

/**
 * The agent turn whose review grid the operator can still change: it must be
 * the last turn of the transcript and not yet sent. Any later message (a new
 * search, a chat follow-up, a report) or sending the review locks it.
 */
export function editableGridId(
  s: Pick<InvestigationState, "turns" | "reviews">,
): string | undefined {
  const id = latestDirective(s.turns, "matches")?.turnId;
  const last = s.turns[s.turns.length - 1];
  return id && id === last?.id && !s.reviews[id]?.sent ? id : undefined;
}

/** The session's live sightings, from the live timeline store. */
const liveOf = (sessionId: string | undefined) =>
  sessionSightings(useLiveTimelineStore.getState(), sessionId);

/** The session's route: confirmed sightings, de-duplicated, in time order. */
const routeNow = (
  s: Pick<InvestigationState, "turns" | "reviews" | "sessionId">,
) => routeOf(s, liveOf(s.sessionId));

function sessionTitle(text: string, hasImage: boolean) {
  const base =
    text.trim().replace(/\s+/g, " ") ||
    (hasImage ? "Image search" : "Investigation");
  return base.length > 64 ? `${base.slice(0, 61)}…` : base;
}

export const useInvestigationStore = create<InvestigationState>()((
  set,
  get,
) => {
  const patchAgent = (id: string, fn: (t: AgentTurn) => AgentTurn) =>
    set((s) => ({
      turns: s.turns.map((t) =>
        t.id === id && t.role === "agent" ? fn(t) : t,
      ),
    }));

  /**
   * Read the run's vss_search_video result from the session transcript: the
   * grid shows only what VSS returned to Argus, never hits the model wrote.
   */
  async function ground(agentId: string) {
    const turns = get().turns;
    const i = turns.findIndex((t) => t.id === agentId);
    const turn = turns[i];
    const op = turns[i - 1];
    const sessionId = get().sessionId;
    if (turn?.role !== "agent" || !sessionId) return;
    // A grid needs its search result even if the tool events were lost.
    const hasGrid = extractDirectives(turn.text).some(
      (d) => d.type === "matches",
    );
    if (!turn.tools.length && !hasGrid) return;
    patchAgent(agentId, (t) => ({
      ...t,
      grounding: true,
      groundError: undefined,
    }));
    try {
      const messages = await getAdapters().hermes.getMessages(sessionId);
      const search = groundingForRun(
        messages,
        op?.role === "operator" ? op.input : undefined,
      );
      if (search) patchAgent(agentId, (t) => ({ ...t, search }));
      else if (hasGrid)
        patchAgent(agentId, (t) => ({
          ...t,
          groundError: "No vss_search_video result found in the transcript.",
        }));
    } catch (e) {
      patchAgent(agentId, (t) => ({
        ...t,
        groundError: (e as Error).message || "Request failed.",
      }));
    } finally {
      patchAgent(agentId, (t) => ({ ...t, grounding: false }));
    }
  }

  /** What the live search watches for: the latest image, else the latest prompt. */
  function watchSubject(): WatchSubject | undefined {
    const { turns } = get();
    const query = subjectTextOf(turns);
    if (!query) return undefined;
    const img = subjectImageOf(turns);
    return { imageUrl: img?.imageUrl, previewUrl: img?.previewUrl, query };
  }

  /** Phase to return to when a run ends without a new grid. */
  function settledPhase(): InvestigationPhase {
    const p = get().phase;
    return p === "searching" || p === "tracing" || p === "reporting"
      ? "idle"
      : p;
  }

  /**
   * Create the session if needed and start the Hermes run. Returns undefined
   * when the operator pressed Stop before the run started. A session created
   * here is deleted again if its first run doesn't start.
   */
  async function begin(
    op: OperatorTurn,
    phase: InvestigationPhase,
  ): Promise<string | undefined> {
    const { hermes } = getAdapters();
    let sessionId = get().sessionId;
    let created: { id: string; title: string } | undefined;
    if (!sessionId) {
      const title = sessionTitle(op.text, !!op.image);
      const session = await hermes.createSession(
        `${env.sessionPrefix}${title}`,
      );
      created = { id: session.id, title };
      sessionId = session.id;
    }
    /** Remove the empty session again; say so if that fails too. */
    async function discard(e?: unknown) {
      if (!created) return;
      try {
        await hermes.deleteSession(created.id);
      } catch (de) {
        throw new Error(
          `${e ? `${errorText(e)} ` : ""}The empty investigation couldn't be removed from Hermes: ${errorText(de)}`,
        );
      }
    }
    let runId: string | undefined;
    try {
      const settings = useSettingsStore.getState();
      // Argus needs the plan to list the free camera positions.
      await loadDefaultFloorplan();
      const fleet = useCamerasStore.getState();
      const watch = useWatchStore.getState();
      const instructions = buildInstructions(
        instructionContext(
          {
            ...get(),
            live: liveOf(sessionId),
            phase,
            subject: watchSubject()?.query,
          },
          {
            fleet: { ...fleet, hasLiveCamera: selectHasLiveCamera(fleet) },
            freePositions: freeFloorplanCameras(fleet.cameras),
            watchingQueryId: isWatchActive(watch) ? watch.queryId : undefined,
            zone: cameraZone,
            minScore: settings.minTraceScore,
            limit: settings.searchLimit,
          },
        ),
      );
      if (!get().stopping)
        runId = (
          await hermes.startRun({ input: op.input, sessionId, instructions })
        ).runId;
    } catch (e) {
      await discard(e);
      throw e;
    }
    if (!runId) {
      await discard();
      return undefined;
    }
    if (created) set({ sessionId: created.id, title: created.title });
    return runId;
  }

  /** Stream a started run into its agent turn, then settle the investigation. */
  async function follow(
    agentId: string,
    runId: string,
    op: OperatorTurn,
    before: InvestigationPhase,
  ) {
    const { hermes } = getAdapters();
    const sessionId = get().sessionId;
    if (sessionId)
      sessionStorage.setItem(
        ACTIVE_RUN_KEY,
        JSON.stringify({ sessionId, runId, op } satisfies ActiveRun),
      );
    try {
      controller = new AbortController();
      await hermes.streamRun(
        runId,
        (ev) => patchAgent(agentId, (t) => applyRunEvent(t, ev)),
        controller.signal,
      );
      await ground(agentId);
      void useCamerasStore.getState().load();
    } catch (e) {
      patchAgent(agentId, (t) =>
        t.status === "streaming"
          ? { ...t, status: "failed", error: errorText(e) }
          : t,
      );
    } finally {
      controller = undefined;
      forgetActiveRun(runId);
      finish(agentId, op, before);
    }
  }

  function finish(
    agentId: string,
    op: OperatorTurn,
    before: InvestigationPhase,
  ) {
    patchAgent(agentId, (t) =>
      t.status === "streaming"
        ? { ...t, status: get().stopping ? "cancelled" : "done" }
        : t,
    );
    const final = get().turns.find((t) => t.id === agentId) as
      AgentTurn | undefined;
    const settled =
      final && final.status === "done"
        ? confirmsSightings(op)
          ? "traced"
          : settleAfter(final.text, before)
        : before;
    set((s) => ({
      busy: false,
      stopping: false,
      activeRunId: undefined,
      phase: settled,
      revision: s.revision + 1,
    }));
  }

  /** Ask Hermes to stop `runId`; on failure keep following it. */
  async function requestStop(runId: string) {
    try {
      await getAdapters().hermes.stopRun(runId);
    } catch (e) {
      // The run may still be going on Hermes: keep showing it (no Retry, no
      // second run) and let the operator press Stop again.
      if (get().activeRunId === runId) set({ stopping: false });
      toast.error("Couldn't stop Argus", {
        description: `${errorText(e)} Argus may still be working; try Stop again.`,
      });
      return;
    }
    // If Hermes never confirms the cancel, release the UI anyway.
    setTimeout(() => {
      if (get().activeRunId === runId) controller?.abort();
    }, 4000);
  }

  /** Run one operator turn. Resolves true once Hermes accepted the run. */
  async function run(
    op: OperatorTurn,
    phase: InvestigationPhase,
  ): Promise<boolean> {
    if (get().busy) return false;
    const before = settledPhase();
    const agent = newAgentTurn();
    set((s) => ({
      turns: [...s.turns, op, agent],
      busy: true,
      stopping: false,
      phase,
    }));
    let runId: string | undefined;
    try {
      runId = await begin(op, phase);
    } catch (e) {
      patchAgent(agent.id, (t) => ({
        ...t,
        status: "failed",
        error: errorText(e),
      }));
    }
    if (!runId) {
      finish(agent.id, op, before);
      return false;
    }
    patchAgent(agent.id, (t) => ({ ...t, runId }));
    set({ activeRunId: runId });
    // Stop was pressed while the run was starting.
    if (get().stopping) void requestStop(runId);
    await follow(agent.id, runId, op, before);
    return true;
  }

  /**
   * After a refresh: follow the run this tab started in `sessionId` if Hermes
   * is still running it, so its reply streams in and no second run starts.
   */
  async function reattach(sessionId: string, mine: number) {
    const active = readActiveRun();
    if (active?.sessionId !== sessionId) return;
    let status: string;
    try {
      status = (await getAdapters().hermes.getRun(active.runId)).status;
    } catch (e) {
      if (mine !== loadToken) return;
      if (e instanceof HermesError && e.status === 404) {
        forgetActiveRun(active.runId);
        return;
      }
      toast.warning("Couldn't check whether Argus is still working", {
        description: `${errorText(e)} Wait for it to finish before sending.`,
      });
      return;
    }
    if (mine !== loadToken || get().busy) return;
    if (RUN_ENDED.has(status)) {
      forgetActiveRun(active.runId);
      return;
    }
    // The transcript may already hold the run's prompt and a partial reply.
    const turns = get().turns;
    const isRunOp = (t: Turn) =>
      t.role === "operator" && t.input === active.op.input;
    let i = turns.length - 1;
    while (i >= 0 && !isRunOp(turns[i])) i--;
    const kept = i >= 0 ? turns.slice(0, i) : turns;
    const stored = active.op;
    const op: OperatorTurn =
      i >= 0
        ? (turns[i] as OperatorTurn)
        : {
            ...stored,
            // A local preview URL died with the page.
            image: stored.image && {
              imageUrl: stored.image.imageUrl,
              previewUrl:
                toDatastorePath(stored.image.imageUrl) ??
                stored.image.previewUrl,
            },
          };
    const agent: AgentTurn = { ...newAgentTurn(), runId: active.runId };
    const next = [...kept, op, agent];
    set({
      turns: next,
      reviews: reviewsFromTurns(next),
      busy: true,
      stopping: false,
      activeRunId: active.runId,
      phase: runningPhase(op.kind, confirmsSightings(op)),
    });
    void follow(agent.id, active.runId, op, phaseFromTurns(kept));
  }

  return {
    turns: [],
    phase: "idle",
    busy: false,
    stopping: false,
    loadingSession: false,
    revision: 0,
    reviews: {},

    async send(text, opts = {}) {
      const kind = classifyPrompt(text, !!opts.image);
      const settings = useSettingsStore.getState();
      const input =
        kind === "report" || kind === "streams"
          ? text.trim()
          : buildSearchInput({
              text,
              imageUrl: opts.image?.imageUrl,
              limit: settings.searchLimit,
            });
      const op: OperatorTurn = {
        id: uid("op"),
        role: "operator",
        kind,
        ...(kind === "report"
          ? splitReportPrompt(text)
          : { text: text.trim() || IMAGE_ONLY_PROMPT }),
        input,
        image: opts.image
          ? { previewUrl: opts.image.previewUrl, imageUrl: opts.image.imageUrl }
          : undefined,
        createdAt: Date.now(),
      };
      const phase =
        kind === "streams" ? get().phase : runningPhase(kind, false);
      await run(op, phase);
    },

    async startWatch() {
      const { sessionId } = get();
      // Decided at Start, so Search again follows the latest image or prompt.
      const subject = watchSubject();
      if (!subject || !sessionId) {
        toast.info("Search the footage first", {
          description:
            "The live camera search looks for the subject of your latest search: describe the person or add a photo.",
        });
        return;
      }
      // Without a photo, show the first confirmed sighting as the subject.
      await useWatchStore.getState().start(
        {
          ...subject,
          previewUrl: subject.previewUrl ?? routeNow(get())[0]?.hit.posterUrl,
        },
        sessionId,
      );
    },

    setVerdicts(turnId, verdicts) {
      if (turnId !== editableGridId(get())) return;
      set((s) => ({
        reviews: { ...s.reviews, [turnId]: { ...s.reviews[turnId], verdicts } },
      }));
    },

    async submitReview(turnId, verdicts, opts) {
      if (get().busy || turnId !== editableGridId(get())) return;
      const { confirm, reject } = splitVerdicts(verdicts);
      // Marked sent up front so this run's context already has the new
      // route; rolled back if Hermes never accepts the run.
      set((s) => ({
        reviews: { ...s.reviews, [turnId]: { verdicts, sent: verdicts } },
      }));
      const queryId = opts.queryId;
      const op: OperatorTurn = {
        id: uid("op"),
        role: "operator",
        kind: "feedback",
        text: describeFeedback(confirm, reject),
        input: serializeFeedback({
          queryId,
          confirm,
          reject,
          labels: opts.labels,
        }),
        createdAt: Date.now(),
      };
      const started = await run(
        op,
        runningPhase("feedback", confirm.length > 0),
      );
      if (started) return;
      // Hermes never got the review: drop the failed exchange so the grid is
      // the last turn again and can be sent once more.
      const turns = get().turns;
      const failed = turns[turns.findIndex((t) => t.id === op.id) + 1] as
        AgentTurn | undefined;
      set((s) => ({
        turns: s.turns.filter((t) => t.id !== op.id && t.id !== failed?.id),
        reviews: { ...s.reviews, [turnId]: { verdicts } },
      }));
      toast.error("Review not sent", {
        description: failed?.error ?? "Argus couldn't start. Try again.",
      });
    },

    async retry(agentTurnId) {
      const turns = get().turns;
      const i = turns.findIndex((t) => t.id === agentTurnId);
      const turn = turns[i];
      const op = turns[i - 1];
      // Only the latest streamed reply: retrying an older one would reorder
      // the transcript, and a restored one is already in the Hermes session.
      if (i !== turns.length - 1 || turn?.role !== "agent" || turn.replayed)
        return;
      if (i < 1 || !op || op.role !== "operator") return;
      const reviews = { ...get().reviews };
      delete reviews[agentTurnId];
      set({ turns: turns.slice(0, i - 1), reviews });
      await run(
        { ...op, id: uid("op"), createdAt: Date.now() },
        runningPhase(op.kind, confirmsSightings(op)),
      );
    },

    async reground(agentTurnId) {
      if (!get().busy) await ground(agentTurnId);
    },

    async stop() {
      if (!get().busy || get().stopping) return;
      set({ stopping: true });
      const runId = get().activeRunId;
      // Without a run id yet, run() stops the run as soon as it has one.
      if (runId) await requestStop(runId);
    },

    reset() {
      loadToken++;
      controller?.abort();
      const watching = isWatchActive(useWatchStore.getState());
      useWatchStore.getState().clear();
      if (watching)
        toast.info("Live search stopped", {
          description: "It belonged to the investigation you left.",
        });
      set({
        sessionId: undefined,
        title: undefined,
        turns: [],
        phase: "idle",
        activeRunId: undefined,
        busy: false,
        stopping: false,
        loadingSession: false,
        reviews: {},
      });
    },

    async resume(sessionId) {
      if (get().busy || get().sessionId === sessionId) return;
      get().reset();
      const mine = ++loadToken;
      set({ loadingSession: true, sessionId });
      try {
        const { hermes } = getAdapters();
        const [messages, session] = await Promise.all([
          hermes.getMessages(sessionId),
          hermes.getSession(sessionId),
        ]);
        // Another investigation was opened meanwhile: drop this response.
        if (mine !== loadToken) return;
        const turns = turnsFromMessages(messages);
        const reviews = reviewsFromTurns(turns);
        set({
          turns,
          phase: phaseFromTurns(turns),
          title: session.title.startsWith(env.sessionPrefix)
            ? session.title.slice(env.sessionPrefix.length)
            : session.title,
          reviews,
        });
        // Still loading, so nothing can be sent before this check is done.
        await reattach(sessionId, mine);
      } catch (e) {
        if (mine !== loadToken) return;
        throw e;
      } finally {
        if (mine === loadToken) set({ loadingSession: false });
      }
    },
  };
});
