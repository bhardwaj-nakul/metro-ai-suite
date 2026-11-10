// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HermesError,
  type HermesMessage,
  type RunEvent,
} from "@/adapters/hermes/types";
import { serializeFeedback } from "@/protocol/feedback";
import type { AgentTurn, OperatorTurn } from "./investigation.logic";

const hermes = {
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  getMessages: vi.fn(),
  getSession: vi.fn(),
  getRun: vi.fn(),
  startRun: vi.fn(),
  streamRun: vi.fn(),
  stopRun: vi.fn(),
};
vi.mock("@/adapters", () => ({ getAdapters: () => ({ hermes }) }));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("./floorplan", () => ({
  loadDefaultFloorplan: async () => undefined,
  freeFloorplanCameras: () => [],
  cameraZone: () => undefined,
}));
vi.mock("./cameras", () => ({
  useCamerasStore: {
    getState: () => ({ cameras: [], load: async () => undefined }),
  },
  selectHasLiveCamera: () => false,
}));
const watch = { status: undefined as string | undefined, clear: vi.fn() };
vi.mock("./watch", () => ({
  useWatchStore: { getState: () => watch },
  isWatchActive: (s: { status?: string }) => s.status === "watching",
}));

const { editableGridId, useInvestigationStore } =
  await import("./investigation");
const { toast } = await import("sonner");

const store = () => useInvestigationStore.getState();

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const completes =
  (text = "Done.") =>
  async (_id: string, onEvent: (e: RunEvent) => void) => {
    onEvent({ type: "delta", text });
    onEvent({ type: "completed" });
  };

const msg = (role: HermesMessage["role"], content: string): HermesMessage => ({
  id: content,
  role,
  content,
});

const grid = '```vsg-matches\n{"v":1,"keep":["m1"]}\n```';

beforeEach(() => {
  Object.values(hermes).forEach((f) => f.mockReset());
  vi.mocked(toast.info).mockReset();
  vi.mocked(toast.error).mockReset();
  watch.status = undefined;
  sessionStorage.clear();
  store().reset();
  hermes.createSession.mockResolvedValue({ id: "s1", title: "VSG · x" });
  hermes.startRun.mockResolvedValue({ runId: "r1" });
  hermes.streamRun.mockImplementation(completes());
  hermes.getMessages.mockResolvedValue([]);
  hermes.deleteSession.mockResolvedValue(undefined);
  hermes.stopRun.mockResolvedValue(undefined);
});

describe("first run", () => {
  it("deletes the new session when its first run doesn't start", async () => {
    hermes.startRun.mockRejectedValue(new HermesError("Hermes 429", 429));
    await store().send("Find a person in a red jacket");
    expect(hermes.deleteSession).toHaveBeenCalledWith("s1");
    expect(store().sessionId).toBeUndefined();
    const agent = store().turns[1] as AgentTurn;
    expect(agent.status).toBe("failed");
    expect(agent.error).toBe("Hermes 429");
  });

  it("says so when the empty session can't be removed either", async () => {
    hermes.startRun.mockRejectedValue(new Error("Hermes 429"));
    hermes.deleteSession.mockRejectedValue(new Error("Hermes 502"));
    await store().send("Find a person in a red jacket");
    expect((store().turns[1] as AgentTurn).error).toBe(
      "Hermes 429 The empty investigation couldn't be removed from Hermes: Hermes 502",
    );
  });
});

describe("stop", () => {
  it("stops the run as soon as Hermes returns its id", async () => {
    const started = deferred<{ runId: string }>();
    hermes.startRun.mockReturnValue(started.promise);
    hermes.streamRun.mockImplementation(
      async (_id: string, onEvent: (e: RunEvent) => void) =>
        onEvent({ type: "cancelled" }),
    );
    const sent = store().send("Find a person");
    await vi.waitFor(() => expect(hermes.startRun).toHaveBeenCalled());
    await store().stop();
    expect(store().stopping).toBe(true);
    started.resolve({ runId: "r9" });
    await sent;
    expect(hermes.stopRun).toHaveBeenCalledWith("r9");
    expect((store().turns[1] as AgentTurn).status).toBe("cancelled");
  });

  it("keeps following the run when Stop fails, so nothing offers Retry", async () => {
    const stream = deferred<void>();
    hermes.streamRun.mockReturnValue(stream.promise);
    hermes.stopRun.mockRejectedValue(new Error("Hermes 502"));
    const sent = store().send("Find a person");
    await vi.waitFor(() => expect(store().activeRunId).toBe("r1"));
    await store().stop();
    expect(store().busy).toBe(true);
    expect(store().stopping).toBe(false);
    expect((store().turns[1] as AgentTurn).status).toBe("streaming");
    stream.resolve();
    await sent;
  });
});

describe("submitReview", () => {
  async function withGrid() {
    hermes.streamRun.mockImplementationOnce(completes(grid));
    await store().send("Find a person");
    return store().turns[1].id;
  }

  it("rolls the review back and keeps the grid editable when the run doesn't start", async () => {
    const gridId = await withGrid();
    hermes.startRun.mockRejectedValue(new Error("Hermes 503"));
    await store().submitReview(gridId, { m1: "confirm" }, {});
    expect(store().reviews[gridId]).toEqual({ verdicts: { m1: "confirm" } });
    expect(store().turns).toHaveLength(2);
    expect(editableGridId(store())).toBe(gridId);
    expect(toast.error).toHaveBeenCalledWith("Review not sent", {
      description: "Hermes 503",
    });
  });

  it("marks the review sent once the run started and locks the grid", async () => {
    const gridId = await withGrid();
    await store().submitReview(gridId, { m1: "confirm" }, {});
    expect(store().reviews[gridId].sent).toEqual({ m1: "confirm" });
    expect(editableGridId(store())).toBeUndefined();
    store().setVerdicts(gridId, {});
    expect(store().reviews[gridId].verdicts).toEqual({ m1: "confirm" });
  });

  it("locks an unsent grid as soon as another message is sent", async () => {
    const gridId = await withGrid();
    expect(editableGridId(store())).toBe(gridId);
    const next = store().send("Find a person in a red jacket");
    // Locked while the new search is still running, before it has a grid.
    expect(store().busy).toBe(true);
    expect(editableGridId(store())).toBeUndefined();
    await next;
    expect(editableGridId(store())).toBeUndefined();
    hermes.startRun.mockClear();
    await store().submitReview(gridId, { m1: "confirm" }, {});
    expect(hermes.startRun).not.toHaveBeenCalled();
  });
});

describe("retry", () => {
  it("only retries the latest reply", async () => {
    hermes.streamRun.mockImplementationOnce(
      async (_id: string, onEvent: (e: RunEvent) => void) =>
        onEvent({ type: "failed", error: "boom" }),
    );
    await store().send("Find a person");
    const failed = store().turns[1].id;
    await store().send("Find another person");
    hermes.startRun.mockClear();
    await store().retry(failed);
    expect(hermes.startRun).not.toHaveBeenCalled();
    expect(store().turns).toHaveLength(4);
  });
});

describe("resume", () => {
  it("ignores a late response for an investigation that was left", async () => {
    const a = deferred<HermesMessage[]>();
    hermes.getMessages.mockImplementation((id: string) =>
      id === "A" ? a.promise : Promise.resolve([msg("user", "Find B")]),
    );
    hermes.getSession.mockImplementation(async (id: string) => ({
      id,
      title: `VSG · ${id}`,
    }));
    const first = store().resume("A");
    await store().resume("B");
    a.reject(new Error("Hermes 500"));
    await expect(first).resolves.toBeUndefined();
    expect(store().sessionId).toBe("B");
    expect(store().title).toBe("B");
    expect((store().turns[0] as OperatorTurn).text).toBe("Find B");
  });

  it("reattaches to a run that is still going after a refresh", async () => {
    const op: OperatorTurn = {
      id: "op1",
      role: "operator",
      kind: "feedback",
      text: "Confirmed m1.",
      input: serializeFeedback({ confirm: ["m1"], reject: [] }),
      createdAt: 0,
    };
    sessionStorage.setItem(
      "vsg-active-run",
      JSON.stringify({ sessionId: "s1", runId: "r1", op }),
    );
    hermes.getMessages.mockResolvedValue([
      msg("user", "Find a person"),
      msg("assistant", grid),
      msg("user", op.input),
    ]);
    hermes.getSession.mockResolvedValue({ id: "s1", title: "VSG · x" });
    hermes.getRun.mockResolvedValue({ status: "running" });
    const stream = deferred<void>();
    hermes.streamRun.mockReturnValue(stream.promise);
    await store().resume("s1");
    expect(store().busy).toBe(true);
    expect(store().activeRunId).toBe("r1");
    expect(store().turns).toHaveLength(4);
    expect(store().turns.at(-1)).toMatchObject({ role: "agent", runId: "r1" });
    expect(hermes.streamRun.mock.calls[0][0]).toBe("r1");
    stream.resolve();
    await vi.waitFor(() => expect(store().busy).toBe(false));
    expect(sessionStorage.getItem("vsg-active-run")).toBeNull();
  });

  it("doesn't reattach to a run that already ended", async () => {
    sessionStorage.setItem(
      "vsg-active-run",
      JSON.stringify({
        sessionId: "s1",
        runId: "r1",
        op: { role: "operator", input: "x" },
      }),
    );
    hermes.getSession.mockResolvedValue({ id: "s1", title: "VSG · x" });
    hermes.getRun.mockResolvedValue({ status: "completed" });
    await store().resume("s1");
    expect(store().busy).toBe(false);
    expect(hermes.streamRun).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("vsg-active-run")).toBeNull();
  });
});

describe("live search", () => {
  it("says the live search stopped when the investigation is left", () => {
    watch.status = "watching";
    store().reset();
    expect(watch.clear).toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      "Live search stopped",
      expect.anything(),
    );
  });

  it("explains why Start live search needs a search first", async () => {
    await store().startWatch();
    expect(toast.info).toHaveBeenCalledWith(
      "Search the footage first",
      expect.anything(),
    );
  });
});
