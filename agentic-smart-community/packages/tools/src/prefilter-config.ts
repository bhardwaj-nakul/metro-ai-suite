/** Shared validation for registration, update previews and binding preferences. */
export function validatePrefilterConfig(pipeline?: Record<string, any>): void {
  const pf = pipeline?.prefilter;
  if (pf === undefined) return;
  if (!pf || typeof pf !== "object" || Array.isArray(pf)) throw new Error("prefilter must be an object");
  const allowed = new Set(["enabled", "model", "target_classes", "min_confidence", "min_frames_hit", "detect_fps", "device", "long_side"]);
  for (const [key, value] of Object.entries(pf)) {
    // Models are chosen by registry name; the analytics service rejects a path.
    if (key === "model_path") throw new Error("prefilter.model_path is not accepted; select a registered model by name with prefilter.model (see monitor_ctl prefilter_options)");
    if (!allowed.has(key)) throw new Error(`unsupported prefilter parameter: ${key}`);
    if (key === "enabled" && typeof value !== "boolean") throw new Error("prefilter.enabled must be boolean");
    if (key === "target_classes" && (!Array.isArray(value) || !value.length || value.some(v => typeof v !== "string" || !v.trim()))) throw new Error("prefilter.target_classes must contain class names");
    if (["device", "model"].includes(key) && (typeof value !== "string" || !value.trim())) throw new Error(`prefilter.${key} must be a non-empty string`);
    if (["min_confidence", "min_frames_hit", "detect_fps", "long_side"].includes(key)) {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`prefilter.${key} must be a finite number`);
      if (key === "min_confidence" && (value < 0 || value > 1)) throw new Error("prefilter.min_confidence must be a number between 0 and 1");
      if (key === "min_frames_hit" && (!Number.isInteger(value) || value < 1)) throw new Error("prefilter.min_frames_hit must be an integer >= 1");
      if (key === "detect_fps" && value <= 0) throw new Error("prefilter.detect_fps must be > 0");
      if (key === "long_side" && (!Number.isInteger(value) || value < 0)) throw new Error("prefilter.long_side must be an integer >= 0");
    }
  }
}
