// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { env } from "@/config/env";
import { managerPath, toDatastorePath } from "@/lib/urls";
import { parseEnvelope, readBody, unexpectedBody } from "../response";
import { normalizeStoredQuery, normalizeStream } from "./normalize";
import {
  SEARCH_IMAGE_MAX_BYTES,
  SEARCH_IMAGE_TYPES,
  VssError,
  type VssAdapter,
} from "./types";

type Json = Record<string, unknown>;

/** A hung VSS request must not stall the live search timers. */
const TIMEOUT_MS = 20_000;

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...init,
      headers: { Accept: "application/json", ...init?.headers },
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError")
      throw new VssError(`VSS did not answer within ${TIMEOUT_MS / 1000} s`);
    throw e;
  }
  const body = await readBody(res);
  if (!res.ok) {
    const msg = (body as Json | undefined)?.message;
    throw new VssError(
      Array.isArray(msg)
        ? msg.join("; ")
        : String(msg ?? `VSS ${res.status} ${res.statusText}`),
      res.status,
    );
  }
  if (typeof body === "string")
    throw new VssError(unexpectedBody("VSS", body), res.status);
  return body;
}

const expect = <S extends z.ZodType>(schema: S, body: unknown, what: string) =>
  parseEnvelope(schema, body, `VSS ${what}`, (m) => new VssError(m));

const object = z.looseObject({});

/** VSS Pipeline Manager client via the same-origin `/vss` prefix. */
export function createHttpVss(base: string = env.vssBase): VssAdapter {
  const m = (p: string) => managerPath(p, base);
  const watchInit = (watch: boolean): RequestInit => ({
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ watch }),
  });
  const watchUrl = (queryId: string) =>
    m(`/search/${encodeURIComponent(queryId)}/watch`);
  const setWatch = (queryId: string, watch: boolean) =>
    getJson(watchUrl(queryId), watchInit(watch)).then(() => undefined);
  return {
    async health() {
      try {
        const res = await fetch(m("/health"), {
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        return res.ok;
      } catch {
        return false;
      }
    },

    async features() {
      const f = expect(object, await getJson(m("/app/features")), "features");
      return {
        search: f.search === "FEATURE_ON",
        summary: f.summary === "FEATURE_ON",
        imageSearch:
          typeof f.imageSearchEnabled === "boolean"
            ? f.imageSearchEnabled
            : undefined,
      };
    },

    async listTags() {
      const tags = expect(
        z.array(z.string()),
        await getJson(m("/tags")),
        "tags",
      );
      return tags.sort();
    },

    async getQuery(queryId) {
      const q = await getJson(m(`/search/${encodeURIComponent(queryId)}`));
      // VSS answers 200 with an empty body for unknown ids.
      if (q === undefined)
        throw new VssError(`Search ${queryId} not found`, 404);
      return normalizeStoredQuery(
        expect(
          z.looseObject({ queryId: z.string().min(1) }),
          q,
          "stored search",
        ),
      );
    },

    async uploadImage(file, filename = "query.jpg") {
      if (!SEARCH_IMAGE_TYPES.includes(file.type))
        throw new VssError("Use a JPEG, PNG or WebP image.");
      if (file.size > SEARCH_IMAGE_MAX_BYTES)
        throw new VssError("Images must be 2 MB or smaller.");
      const form = new FormData();
      form.append("image", file, filename);
      const body = expect(
        object,
        await getJson(m("/search/images"), { method: "POST", body: form }),
        "image upload",
      );
      const imageUrl = String(body.imageUrl ?? body.imagePath ?? "");
      if (!imageUrl) throw new VssError("VSS did not return an image URL.");
      return {
        imageId: typeof body.imageId === "string" ? body.imageId : undefined,
        imageUrl,
        // Never point the browser at a host VSS named: fall back to the local file.
        previewUrl:
          toDatastorePath(imageUrl, base) ?? URL.createObjectURL(file),
      };
    },

    async listStreams() {
      const body = expect(
        z.looseObject({
          streams: z.array(z.looseObject({ stream_id: z.string().min(1) })),
        }),
        await getJson(m("/streams")),
        "stream list",
      );
      return body.streams.map(normalizeStream);
    },

    async addStream(input) {
      const body: Json = { stream_url: input.streamUrl.trim() };
      if (input.name?.trim()) body.stream_name = input.name.trim();
      if (input.description?.trim())
        body.description = input.description.trim();
      if (input.tags?.length) body.tags = input.tags;
      if (input.frameInterval) body.frame_interval = input.frameInterval;
      if (input.objectDetection !== undefined)
        body.enable_object_detection = input.objectDetection;
      if (input.start !== undefined) body.start = input.start;
      await getJson(m("/streams"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },

    async updateStream(id, patch) {
      const body: Json = {};
      if (patch.state) body.state = patch.state;
      if (patch.frameInterval) body.frame_interval = patch.frameInterval;
      if (patch.objectDetection !== undefined)
        body.enable_object_detection = patch.objectDetection;
      await getJson(m(`/streams/${encodeURIComponent(id)}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },

    async removeStream(id) {
      await getJson(m(`/streams/${encodeURIComponent(id)}`), {
        method: "DELETE",
      });
    },

    async startWatch(req) {
      const body: Json = req.imageUrl
        ? { imageUrl: req.imageUrl }
        : { query: req.query?.trim() };
      if (!req.imageUrl && !req.query?.trim())
        throw new VssError("Describe the person or attach a photo to watch.");
      if (req.windowMinutes)
        body.timeFilter = {
          value: req.windowMinutes,
          unit: "minutes",
          source: "relative",
        };
      const { queryId } = expect(
        z.looseObject({ queryId: z.string().min(1) }),
        await getJson(m("/search"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        "search",
      );
      await setWatch(queryId, true);
      return queryId;
    },

    setWatch,

    unwatchOnUnload(queryId) {
      // The page is going away: nobody is left to see the result.
      void fetch(watchUrl(queryId), { ...watchInit(false), keepalive: true });
    },
  };
}
