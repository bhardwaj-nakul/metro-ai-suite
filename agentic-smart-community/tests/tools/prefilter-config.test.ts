// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePrefilterConfig } from "../../packages/tools/src/prefilter-config.ts";

// Models are chosen by registry name. The analytics service rejects a request
// that carries a path, so the shared validator must accept `model`, and turn a
// `model_path` away early with a message that says what to use instead.

test("prefilter.model (a registry name) is accepted", () => {
  assert.doesNotThrow(() =>
    validatePrefilterConfig({ prefilter: { enabled: true, model: "yolo11m", target_classes: ["person"], device: "GPU" } }),
  );
});

test("prefilter.model_path is rejected and the message points at prefilter.model", () => {
  assert.throws(
    () => validatePrefilterConfig({ prefilter: { enabled: true, model_path: "/models/openvino/x.xml" } }),
    /model_path is not accepted.*prefilter\.model/,
  );
});

test("prefilter.model must be a non-empty string", () => {
  for (const bad of ["", "   ", 7, null, ["yolo11s"]]) {
    assert.throws(() => validatePrefilterConfig({ prefilter: { model: bad as any } }), /model must be a non-empty string|prefilter/);
  }
});

test("unknown prefilter parameters are still rejected", () => {
  assert.throws(() => validatePrefilterConfig({ prefilter: { nms_iou: 0.5 } }), /unsupported prefilter parameter: nms_iou/);
});

test("an absent prefilter block is fine", () => {
  assert.doesNotThrow(() => validatePrefilterConfig({}));
  assert.doesNotThrow(() => validatePrefilterConfig(undefined));
});
