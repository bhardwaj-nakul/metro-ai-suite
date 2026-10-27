// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { SmartCommunityDB } from "@smart-community-video/db";
import { monitorCtl } from "@smart-community-video/tools";
import type { IWorkerService } from "@smart-community-video/tools";

// register_prefilter_model is the one action that WRITES the VSA config file,
// so it gets a fake analytics service that behaves like VSA: /config/reload
// re-reads the file and /capabilities/prefilter reports what that read found.

function fakeWorkerService(): IWorkerService {
  return { workers: new Map(), start() {}, async stop() {} };
}

const BASE_CONFIG = `# my VSA config — keep this comment
model_dir: /models
prefilter_models:
  yolo11s:
    kind: detection
    backend: openvino
    model_path: /models/yolo11s/yolo11s.xml
`;

interface Fake {
  url: string;
  reloads: number;
  close(): Promise<void>;
}

/** `readsFile` false simulates VSA looking at a different file than the one edited. */
async function startFakeVsa(
  configPath: string,
  opts: { readsFile?: boolean; rejectNames?: Record<string, string> } = {},
): Promise<Fake> {
  const readsFile = opts.readsFile ?? true;
  let registry: Record<string, any> = {};
  const load = async () => {
    if (!readsFile) return;
    registry = (parse(await readFile(configPath, "utf-8")) ?? {}).prefilter_models ?? {};
  };
  await load();
  const fake: Fake = { url: "", reloads: 0, close: async () => {} };
  const server: Server = createServer(async (req, res) => {
    const send = (body: unknown) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && req.url === "/config/reload") {
      fake.reloads++;
      await load();
      return send({ status: "reloaded", path: configPath });
    }
    if (req.method === "GET" && req.url?.startsWith("/capabilities/prefilter")) {
      const models: any[] = [];
      const rejected: any[] = [];
      for (const [name, e] of Object.entries<any>(registry)) {
        const reason = opts.rejectNames?.[name];
        if (reason) rejected.push({ name, model_path: e.model_path, reason });
        else models.push({ name, kind: e.kind, backend: e.backend ?? "openvino", model_path: e.model_path });
      }
      return send({ models, rejected });
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.close = () => new Promise<void>((r) => server.close(() => r()));
  return fake;
}

async function withEnv(
  run: (env: { db: SmartCommunityDB; configPath: string }) => Promise<void>,
  initial: string = BASE_CONFIG,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "prefilter-model-"));
  const db = new SmartCommunityDB(join(dir, "test.db"));
  db.initialize();
  const configPath = join(dir, "config.yaml");
  await writeFile(configPath, initial, "utf-8");
  const saved = process.env.VIDEOSTREAM_CONFIG_FILE;
  process.env.VIDEOSTREAM_CONFIG_FILE = configPath;
  try {
    await run({ db, configPath });
  } finally {
    if (saved === undefined) delete process.env.VIDEOSTREAM_CONFIG_FILE;
    else process.env.VIDEOSTREAM_CONFIG_FILE = saved;
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const register = (db: SmartCommunityDB, url: string, params: Record<string, unknown>) =>
  monitorCtl(db, url, fakeWorkerService(), { action: "register_prefilter_model", ...params } as any) as Promise<any>;

test("register_prefilter_model writes the entry, preserves comments, reloads, and confirms selectable", async () => {
  await withEnv(async ({ db, configPath }) => {
    const vsa = await startFakeVsa(configPath);
    try {
      const out = await register(db, vsa.url, {
        model: "helmet_v2",
        model_path: "/models/helmet/helmet_v2.xml",
        description: "Safety-helmet detector",
      });
      assert.equal(out.status, "selectable");
      assert.equal(out.entry.name, "helmet_v2");
      assert.equal(vsa.reloads >= 1, true);

      const text = await readFile(configPath, "utf-8");
      assert.match(text, /# my VSA config — keep this comment/);
      const saved = parse(text).prefilter_models;
      assert.deepEqual(saved.helmet_v2, {
        kind: "detection",
        backend: "openvino",
        model_path: "/models/helmet/helmet_v2.xml",
        description: "Safety-helmet detector",
      });
      assert.ok(saved.yolo11s, "existing entries are untouched");
    } finally {
      await vsa.close();
    }
  });
});

test("register_prefilter_model is idempotent for an identical entry and does not rewrite the file", async () => {
  await withEnv(async ({ db, configPath }) => {
    const vsa = await startFakeVsa(configPath);
    try {
      const before = await readFile(configPath, "utf-8");
      const out = await register(db, vsa.url, {
        model: "yolo11s",
        model_path: "/models/yolo11s/yolo11s.xml",
      });
      assert.equal(out.status, "selectable");
      assert.match(out.note, /already registered/);
      assert.equal(await readFile(configPath, "utf-8"), before);
    } finally {
      await vsa.close();
    }
  });
});

test("register_prefilter_model refuses to overwrite a conflicting entry", async () => {
  await withEnv(async ({ db, configPath }) => {
    const vsa = await startFakeVsa(configPath);
    try {
      const before = await readFile(configPath, "utf-8");
      await assert.rejects(
        register(db, vsa.url, { model: "yolo11s", model_path: "/models/other.xml" }),
        /already registered with different settings/,
      );
      assert.equal(await readFile(configPath, "utf-8"), before, "operator config must be left alone");
    } finally {
      await vsa.close();
    }
  });
});

test("register_prefilter_model reports a VSA-rejected entry with the reason", async () => {
  await withEnv(async ({ db, configPath }) => {
    const vsa = await startFakeVsa(configPath, {
      rejectNames: { broken: "cannot read /models/broken.bin: No such file or directory" },
    });
    try {
      const out = await register(db, vsa.url, { model: "broken", model_path: "/models/broken.xml" });
      assert.equal(out.status, "rejected");
      assert.match(out.reason, /broken\.bin/);
    } finally {
      await vsa.close();
    }
  });
});

test("register_prefilter_model flags a write VSA never saw as written_not_listed", async () => {
  await withEnv(async ({ db, configPath }) => {
    const vsa = await startFakeVsa(configPath, { readsFile: false });
    try {
      const out = await register(db, vsa.url, { model: "helmet_v2", model_path: "/models/h.xml" });
      assert.equal(out.status, "written_not_listed");
      assert.match(out.hint, /restart the MCP server/);
      assert.match(out.hint, /VIDEOSTREAM_CONFIG_FILE/);
    } finally {
      await vsa.close();
    }
  });
});

test("concurrent register_prefilter_model calls both persist (read-modify-write is not interleaved)", async () => {
  await withEnv(async ({ db, configPath }) => {
    const vsa = await startFakeVsa(configPath);
    try {
      const names = ["m_a", "m_b", "m_c", "m_d"];
      await Promise.all(
        names.map((n) => register(db, vsa.url, { model: n, model_path: `/models/${n}.xml` })),
      );
      const saved = Object.keys(parse(await readFile(configPath, "utf-8")).prefilter_models);
      for (const n of names) assert.ok(saved.includes(n), `${n} was lost`);
    } finally {
      await vsa.close();
    }
  });
});

test("register_prefilter_model validates its inputs before touching the file", async () => {
  await withEnv(async ({ db, configPath }) => {
    const before = await readFile(configPath, "utf-8");
    await assert.rejects(register(db, "http://127.0.0.1:1", { model_path: "/m.xml" }), /model .*required/);
    await assert.rejects(register(db, "http://127.0.0.1:1", { model: "x" }), /model_path is required/);
    await assert.rejects(
      register(db, "http://127.0.0.1:1", { model: "x", model_path: "relative/m.xml" }),
      /absolute path/,
    );
    assert.equal(await readFile(configPath, "utf-8"), before);
  });
});

test("register_prefilter_model needs VIDEOSTREAM_CONFIG_FILE and a readable file", async () => {
  await withEnv(async ({ db }) => {
    delete process.env.VIDEOSTREAM_CONFIG_FILE;
    await assert.rejects(
      register(db, "http://127.0.0.1:1", { model: "x", model_path: "/m.xml" }),
      /VIDEOSTREAM_CONFIG_FILE is not set/,
    );
    process.env.VIDEOSTREAM_CONFIG_FILE = "/nonexistent/config.yaml";
    await assert.rejects(
      register(db, "http://127.0.0.1:1", { model: "x", model_path: "/m.xml" }),
      /cannot read VSA config.*setup_vsa\.sh/,
    );
  });
});
