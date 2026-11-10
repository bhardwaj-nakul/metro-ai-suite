// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VssError, type VssHit } from "@/adapters/vss/types";
import { useSettingsStore } from "./settings";
import { useLiveTimelineStore } from "./liveTimeline";
import { MAX_POLL_FAILURES, useWatchStore } from "./watch";

const vss = {
  startWatch: vi.fn(),
  getQuery: vi.fn(),
  setWatch: vi.fn(),
  unwatchOnUnload: vi.fn(),
};
vi.mock("@/adapters", () => ({ getAdapters: () => ({ vss }) }));

const live = (n: number, source: VssHit["source"] = "live"): VssHit => ({
  matchId: `m${n}`,
  rank: n,
  videoId: `v${n}`,
  streamId: "cam-1",
  cameraTag: "cam-1",
  observedAt: `2026-01-01T10:00:0${n}Z`,
  startS: 0,
  endS: 5,
  seekS: 0,
  score: 0.9,
  source,
});

/** Let the pending poll (and its awaited getQuery) run. */
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("watch store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vss.startWatch.mockResolvedValue("q-1");
    vss.getQuery.mockResolvedValue({ hits: [] });
    vss.setWatch.mockResolvedValue(undefined);
    useSettingsStore.setState({ watchMinutes: 30, watchIdleMinutes: 10 });
  });
  afterEach(() => {
    useWatchStore.getState().clear();
    useLiveTimelineStore.setState({ bySession: {} });
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("starts from the subject image and polls every 10 s, keeping new live hits", async () => {
    vss.getQuery
      .mockResolvedValueOnce({ hits: [live(1), live(2, "video")] })
      .mockResolvedValueOnce({ hits: [live(1), live(3)] });
    await useWatchStore
      .getState()
      .start({ imageUrl: "/img.jpg", query: "blue jacket" }, "s1");
    expect(vss.startWatch).toHaveBeenCalledWith({
      query: undefined,
      imageUrl: "/img.jpg",
      windowMinutes: 5,
    });
    await flush();
    expect(useWatchStore.getState().status).toBe("watching");
    const timeline = () => useLiveTimelineStore.getState().bySession.s1 ?? [];
    expect(timeline().map((x) => [x.camera, x.count])).toEqual([["cam-1", 1]]);

    // The window repeats m1; m3 extends the same camera's sighting.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vss.getQuery).toHaveBeenCalledTimes(2);
    expect(timeline().map((x) => [x.camera, x.count, x.end])).toEqual([
      ["cam-1", 2, "2026-01-01T10:00:03.000Z"],
    ]);
  });

  it("stops after the idle limit with no new sighting", async () => {
    useSettingsStore.setState({ watchIdleMinutes: 1 });
    await useWatchStore.getState().start({ query: "blue jacket" }, "s1");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(useWatchStore.getState().status).toBe("idle-stopped");
    expect(vss.setWatch).toHaveBeenCalledWith("q-1", false);
  });

  it("stops at the watch duration even while sightings keep coming", async () => {
    useSettingsStore.setState({ watchMinutes: 1, watchIdleMinutes: 10 });
    let n = 0;
    vss.getQuery.mockImplementation(async () => ({ hits: [live(++n % 10)] }));
    await useWatchStore.getState().start({ query: "blue jacket" }, "s1");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(useWatchStore.getState().status).toBe("expired");
  });

  it("stop ends polling; a second start never replaces a running watch", async () => {
    await useWatchStore.getState().start({ query: "blue jacket" }, "s1");
    await flush();
    await useWatchStore.getState().start({ query: "other" }, "s1");
    expect(useWatchStore.getState().subject?.query).toBe("blue jacket");

    await useWatchStore.getState().stop();
    const calls = vss.getQuery.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vss.getQuery).toHaveBeenCalledTimes(calls);
    expect(useWatchStore.getState().status).toBe("stopped");
    expect(vss.setWatch).toHaveBeenCalledWith("q-1", false);
  });

  it("Stop while VSS is still creating the query unwatches it once it exists", async () => {
    let resolve!: (id: string) => void;
    vss.startWatch.mockReturnValue(new Promise((r) => (resolve = r)));
    const starting = useWatchStore
      .getState()
      .start({ query: "blue jacket" }, "s1");
    await useWatchStore.getState().stop();
    resolve("q-late");
    await starting;
    await flush();
    expect(vss.setWatch).toHaveBeenCalledWith("q-late", false);
    expect(vss.getQuery).not.toHaveBeenCalled();
    expect(useWatchStore.getState().status).toBe("stopped");
  });

  it("a failed unwatch is an error the operator can retry", async () => {
    await useWatchStore.getState().start({ query: "blue jacket" }, "s1");
    await flush();
    vss.setWatch.mockRejectedValueOnce(new Error("503"));
    await useWatchStore.getState().stop();
    expect(useWatchStore.getState()).toMatchObject({
      status: "error",
      stopFailed: true,
      queryId: "q-1",
    });
    await useWatchStore.getState().stop();
    expect(useWatchStore.getState().status).toBe("stopped");
    expect(vss.setWatch).toHaveBeenCalledTimes(2);
  });

  it("stops with VSS's message when the watched query fails", async () => {
    vss.getQuery.mockResolvedValue({
      hits: [],
      status: "error",
      errorMessage: "model crashed",
    });
    await useWatchStore.getState().start({ query: "blue jacket" }, "s1");
    await flush();
    expect(useWatchStore.getState()).toMatchObject({
      status: "error",
      error: "model crashed",
    });
    expect(vss.setWatch).toHaveBeenCalledWith("q-1", false);
  });

  it("clear while starting unwatches the query VSS already created", async () => {
    vss.getQuery.mockReturnValue(new Promise(() => {}));
    await useWatchStore.getState().start({ query: "blue jacket" }, "s1");
    expect(useWatchStore.getState()).toMatchObject({
      status: "starting",
      queryId: "q-1",
    });
    useWatchStore.getState().clear();
    expect(vss.setWatch).toHaveBeenCalledWith("q-1", false);
  });

  it("clear after a successful stop doesn't unwatch again", async () => {
    await useWatchStore.getState().start({ query: "blue jacket" }, "s1");
    await flush();
    await useWatchStore.getState().stop();
    useWatchStore.getState().clear();
    expect(vss.setWatch).toHaveBeenCalledTimes(1);
  });

  it("a query VSS no longer has is a failure, not retried", async () => {
    vss.getQuery.mockRejectedValue(new VssError("Search q-1 not found", 404));
    await useWatchStore.getState().start({ query: "blue jacket" }, "s1");
    await flush();
    expect(useWatchStore.getState().status).toBe("error");
    expect(useWatchStore.getState().error).toMatch(/no longer has/);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vss.getQuery).toHaveBeenCalledTimes(1);
    expect(vss.setWatch).not.toHaveBeenCalled();
  });

  it(`fails after ${MAX_POLL_FAILURES} checks in a row fail, even while starting`, async () => {
    vss.getQuery.mockRejectedValue(new Error("502 Bad Gateway"));
    await useWatchStore.getState().start({ query: "blue jacket" }, "s1");
    await flush();
    expect(useWatchStore.getState()).toMatchObject({
      status: "starting",
      error: "502 Bad Gateway",
    });
    await vi.advanceTimersByTimeAsync(10_000 * (MAX_POLL_FAILURES - 1));
    expect(useWatchStore.getState().status).toBe("error");
    expect(useWatchStore.getState().error).toMatch(/checks in a row failed/);
    expect(vss.setWatch).toHaveBeenCalledWith("q-1", false);
  });

  it("closing the tab unwatches a running watch with a keepalive request", async () => {
    await useWatchStore.getState().start({ query: "blue jacket" }, "s1");
    await flush();
    window.dispatchEvent(new Event("pagehide"));
    expect(vss.unwatchOnUnload).toHaveBeenCalledWith("q-1");
  });

  it("a reload unwatches the query the last page load left running", async () => {
    await useWatchStore.getState().start({ query: "blue jacket" }, "s1");
    await flush();
    vss.setWatch.mockClear();
    vi.resetModules();
    await import("./watch");
    expect(vss.setWatch).toHaveBeenCalledWith("q-1", false);
    expect(sessionStorage.getItem("vsg.watch.pending")).toBeNull();
  });
});
