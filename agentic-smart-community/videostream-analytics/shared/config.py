"""Configuration models for videostream-analytics."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Literal, Optional, TypeVar

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator


logger = logging.getLogger(__name__)


ConfigModelT = TypeVar("ConfigModelT", bound=BaseModel)


class MotionConfig(BaseModel):
    enabled: bool = True
    diff_threshold: int = Field(default=25, ge=1, le=255)
    area_ratio: float = Field(default=0.015, ge=0.0, le=1.0)
    stable_frames: int = Field(default=30, ge=1)


class SegmentConfig(BaseModel):
    """Segment cut-over rule.

    `max_duration` — hard ceiling on segment length in seconds; when a running
    segment reaches this, it is closed and a new one starts.

    `min_duration` — cut-frequency guard, NOT a delete filter: forced cuts
    (ROI early-split) are rejected while the running segment is younger than
    this, and prefilter motion-exit is held open until it. Finished segments
    are always emitted regardless of length — short motion-end tails still
    reach the VLM.
    """

    model_config = ConfigDict(extra="forbid")

    max_duration: float = Field(default=10.0, gt=0.0)
    min_duration: float = Field(default=1.0, ge=0.0)

    @model_validator(mode="after")
    def _check_duration_order(self) -> "SegmentConfig":
        """Compare the two durations ONLY when both were explicitly supplied.

        `PUT /sources/{id}/pipeline` merges via `merge_config`'s `exclude_unset`
        semantics, so a body of `{"segment": {"min_duration": 30}}` builds this
        model with the *default* `max_duration=10.0` while the effective value
        after the merge may well be 60. Comparing unconditionally would reject
        that legitimate request. The effective (post-merge) pair is checked by
        `validate_effective_segment`.
        """
        if {"min_duration", "max_duration"} <= self.model_fields_set:
            if self.min_duration > self.max_duration:
                raise ValueError(
                    f"segment.min_duration ({self.min_duration}) must not exceed "
                    f"segment.max_duration ({self.max_duration})"
                )
        return self


class StaticConfig(BaseModel):
    """Static ("quiet period") close-out emission config.

    A `static` event is emitted when motion ends and a new motion begins,
    closing out the intervening quiet span (see rtsp_monitor close-out model).
    `min_duration` suppresses very short gaps to avoid flooding the events
    table with sub-second static rows.
    """

    enabled: bool = True
    min_duration: float = Field(default=3.0, ge=0.0)


class RecordingConfig(BaseModel):
    """Fixed-duration continuous recording config.

    `interval_seconds` is the canonical field MCP sends. `interval` is kept as
    a legacy alias accepted on input but written as `interval_seconds`.
    Recordings on disk are pruned by the MCP server (storage.retention_days);
    VSA does not do its own retention cleanup.

    `backend` selects how segments are produced:
      - "copy" (default): an ffmpeg subprocess pulls the stream and cuts
        segments with `-c copy` — no decode, no encode, original codec/bitrate
        preserved. Requires ffmpeg on PATH.
      - "x264" (rollback): cv2 decode + libx264 re-encode via H264SegmentWriter.
        Kept as an escape hatch; `fps` is only used by this backend.
    """

    model_config = ConfigDict(populate_by_name=True)

    enabled: bool = True
    interval_seconds: int = Field(default=60, alias="interval", ge=1, le=3600)
    fps: int = Field(default=15, ge=1, le=120)
    backend: Literal["copy", "x264"] = "copy"


class RoiConfig(BaseModel):
    """ROI crop configuration (child_safety).

    Top-level pipeline block, at the same nesting depth as `prefilter`.
    When enabled and prefilter accumulates a `trajectory_region_xyxy`, the
    pipeline writes a `<clip>_input.mp4` next to the original segment and
    points `summary_clip_input` there. `auto_split_area` triggers early
    segment cuts when the union bbox grows beyond the fraction (avoids one
    over-large crop on long fast-moving events).
    """

    enabled: bool = False
    mode: Literal["crop", "highlight", "crop_and_concat"] = "crop"
    expand: float = Field(default=0.25, ge=0.0)
    auto_split_area: float = Field(default=0.0, ge=0.0, le=1.0)  # 0 disables early-split


# Model taxonomy. Both tuples are the single place a future tier is added:
# `kind` is what the model *does*, `backend` is what runs it. Phase 1 ships one
# of each, but the registry schema is already shaped for more, so adding e.g.
# classification or a non-OpenVINO runtime needs no config migration.
SUPPORTED_MODEL_KINDS = ("detection",)
SUPPORTED_MODEL_BACKENDS = ("openvino",)

# The model root when PREFILTER_MODEL_DIR is unset (and the config file carries
# no model_dir of its own, which the shipped config does not).
# Matches the deployment default exported by docker/set_env.sh.
DEFAULT_MODEL_DIR = "~/models/openvino"


class PrefilterModelConfig(BaseModel):
    """One entry of the `prefilter_models` registry in config.yaml.

    The registry is the ONLY way a model becomes selectable. Requests and
    `monitors.yaml` name an entry by its key (`prefilter.model`); a raw
    `model_path` from a request is rejected. Every path on the flow into
    `read_model()` is therefore deployment-authored, so an unauthenticated
    caller cannot aim it at an arbitrary file.

    `kind` and `backend` are validated against the SUPPORTED_* tuples above.
    An entry naming an unsupported value is not an error at load time — it is
    reported as unavailable by `/capabilities/prefilter`, so a config written
    for a newer build degrades to "that one model is not selectable here"
    rather than taking the whole service down.
    """

    model_config = ConfigDict(extra="forbid")

    kind: str
    # Case-insensitive on input: users write OpenVINO / OPENVINO / openvino and
    # mean the same runtime. Normalized here so every comparison downstream is
    # a plain `in SUPPORTED_MODEL_BACKENDS`.
    backend: str = "openvino"
    model_path: str
    description: str = ""

    @model_validator(mode="after")
    def _normalize(self) -> "PrefilterModelConfig":
        self.kind = self.kind.strip().lower()
        self.backend = self.backend.strip().lower()
        return self


class PrefilterConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    enabled: bool = False
    # Registry key (`prefilter_models.<name>` in config.yaml). This is what a
    # register_source / update_pipeline request and monitors.yaml supply.
    model: str = ""
    # Resolved from `model` server-side — NOT a request input. A request that
    # sets it explicitly is rejected with 422; see service.resolve_prefilter_model.
    model_path: str = ""
    target_classes: list[str] = Field(default_factory=lambda: ["person"])
    min_confidence: float = Field(default=0.4, ge=0.0, le=1.0)
    min_frames_hit: int = Field(default=2, ge=1)
    detect_fps: float = Field(default=2.0, gt=0.0)
    device: str = "CPU"
    # Long-side resize target for pre-inference frame downscaling (0 disables).
    # Consumed by prefilter_yolo._resize_long_side when > 0.
    long_side: int = Field(default=0, ge=0)


class HealthConfig(BaseModel):
    """Per-source health monitoring configuration."""
    max_failures: int = Field(default=30, ge=1)
    recovery_strategy: Literal["retry", "pause", "remove"] = "retry"
    backoff_base: float = Field(default=2.0, ge=1.0)
    backoff_max: float = Field(default=120.0, gt=0.0)


class KeepaliveConfig(BaseModel):
    """Keepalive protocol configuration.

    When `enabled`, the source must receive `POST /sources/{id}/keepalive`
    within `timeout_seconds` or the watchdog auto-pauses it. Default OFF so
    existing integration scripts that don't send keepalive aren't disturbed.
    """

    enabled: bool = False
    timeout_seconds: float = Field(default=90.0, gt=0.0)
    check_interval_seconds: float = Field(default=10.0, gt=0.0)


class SecurityConfig(BaseModel):
    """Input-surface restrictions for request-supplied stream URLs.

    `source_url` is handed verbatim to `ffmpeg -i` (continuous_recorder.py) and
    to `cv2.VideoCapture(..., CAP_FFMPEG)` (rtsp_monitor.py). ffmpeg supports a
    large protocol set — `file:`, `concat:`, `subfile:`, `http:` — so without an
    allowlist a caller can point a "camera" at any local file or internal HTTP
    endpoint and have the contents muxed into `data_dir`, from where the MCP
    dashboard will happily serve it back as an mp4.

    Prefilter model paths need no equivalent restriction here: a model is
    selected by registry key (`prefilter_models` in config.yaml), so every path
    reaching `read_model()` comes from trusted config rather than a request.
    """

    model_config = ConfigDict(extra="forbid")

    # Schemes accepted in a register_source `source_url`.
    allowed_source_schemes: list[str] = Field(
        default_factory=lambda: ["rtsp", "rtsps", "http", "https"]
    )
    # `file://` sources are off by default: they are a local-file-read primitive.
    # Turn on only for offline evaluation against sample clips on disk.
    allow_file_source: bool = False
    # Passed to ffmpeg as `-protocol_whitelist`. Second line of defence behind
    # `allowed_source_schemes`: even if a URL slips through, ffmpeg itself will
    # refuse to open a protocol that is not listed. `file` and `crypto` are
    # required for the segment muxer's own output handling.
    ffmpeg_protocol_whitelist: list[str] = Field(
        default_factory=lambda: [
            "file", "crypto", "rtp", "udp", "tcp", "tls", "rtsp", "rtsps", "http", "https",
        ]
    )


class WebhookConfig(BaseModel):
    url: str = "http://localhost:3101/events"
    timeout: int = 10
    retry_attempts: int = 3
    retry_delay: float = 2.0


class ServerConfig(BaseModel):
    """HTTP bind address.

    Defaults to loopback: the service has no authentication, so every endpoint
    (register/delete a source, rewrite `webhook_url`, change the pipeline) is
    reachable by anyone who can open a socket. Binding `127.0.0.1` makes the
    kernel drop non-local SYNs outright. The docker deployment is
    `network_mode: host` and MCP reaches VSA over `http://localhost:8999`, so
    loopback is sufficient there. Cross-host deployments must set this
    explicitly (and put their own authentication in front of it).
    """

    host: str = "127.0.0.1"
    port: int = Field(default=8999, ge=1, le=65535)


class DefaultsConfig(BaseModel):
    motion: MotionConfig = Field(default_factory=MotionConfig)
    segment: SegmentConfig = Field(default_factory=SegmentConfig)
    static: StaticConfig = Field(default_factory=StaticConfig)
    recording: RecordingConfig = Field(default_factory=RecordingConfig)
    prefilter: PrefilterConfig = Field(default_factory=PrefilterConfig)
    roi: RoiConfig = Field(default_factory=RoiConfig)
    health: HealthConfig = Field(default_factory=HealthConfig)
    keepalive: KeepaliveConfig = Field(default_factory=KeepaliveConfig)


class SourceConfig(BaseModel):
    """Per-source configuration provided at registration time.

    Field names (`source_url`, nested pipeline blocks) match MCP's
    `analyticsRegister` body exactly.
    """

    source_id: str
    source_url: str
    webhook_url: Optional[str] = None
    data_dir: Optional[str] = None
    motion: Optional[MotionConfig] = None
    segment: Optional[SegmentConfig] = None
    static: Optional[StaticConfig] = None
    recording: Optional[RecordingConfig] = None
    prefilter: Optional[PrefilterConfig] = None
    roi: Optional[RoiConfig] = None
    health: Optional[HealthConfig] = None
    keepalive: Optional[KeepaliveConfig] = None


class AppConfig(BaseModel):
    server: ServerConfig = Field(default_factory=ServerConfig)
    webhook: WebhookConfig = Field(default_factory=WebhookConfig)
    data_dir: str = "~/.mcp-smart-community/segments"
    # Extra roots a register_source `data_dir` is allowed to live under, on top
    # of `data_dir` itself. Empty (the default) means `data_dir` is the only
    # permitted root — which is what the standard deployment needs, since MCP
    # always sends `<SMART_COMMUNITY_DATA_DIR>/segments/<monitor_id>` and VSA
    # derives `data_dir` from the same env var. This list is the escape hatch
    # for deployments that mount the segment tree somewhere else.
    allowed_data_roots: list[str] = Field(default_factory=list)
    # Root every registered prefilter model must live under. Mirrors the
    # read-only bind mount docker-compose makes at the same host path, so an
    # entry outside it is simply not readable in-container; the registry
    # reports that up front as `rejected` instead of letting the pipeline
    # discover it at stream start. Users organize subdirectories however they
    # like — containment is the only rule.
    #
    # An internal parameter, deliberately absent from the shipped config: its
    # value is the PREFILTER_MODEL_DIR env var (which is also what compose
    # mounts), so a copy in the file could only disagree with the mount.
    model_dir: str = DEFAULT_MODEL_DIR
    # Selectable prefilter models, keyed by the name `prefilter.model` uses.
    prefilter_models: dict[str, PrefilterModelConfig] = Field(default_factory=dict)
    security: SecurityConfig = Field(default_factory=SecurityConfig)
    defaults: DefaultsConfig = Field(default_factory=DefaultsConfig)
    logging: dict = Field(default_factory=lambda: {"level": "INFO"})


def expand_path(p: str) -> str:
    """Expand `~` and `$VAR` in a path from a TRUSTED source (config/env).

    Do NOT use this on request-supplied paths — `expandvars` would turn a
    `data_dir` of `"${HOME}/x"` into a server path that is then echoed back in
    the register response and `GET /sources`, handing an unauthenticated caller
    an environment-variable oracle. Use `expand_user_path` for those.
    """
    p = os.path.expanduser(p)
    p = os.path.expandvars(p)
    return p


def expand_user_path(p: str) -> str:
    """Expand `~` only — safe for request-supplied paths (no `$VAR` oracle)."""
    return os.path.expanduser(p)


def validate_effective_segment(cfg: SegmentConfig) -> None:
    """Check the post-merge segment durations. Raises ValueError when inverted.

    `SegmentConfig._check_duration_order` can only compare the pair when both
    were explicitly supplied in one body; this is the check against the
    *effective* config after `merge_config` has filled the gaps from defaults.
    """
    if cfg.min_duration > cfg.max_duration:
        raise ValueError(
            f"effective segment.min_duration ({cfg.min_duration}) must not exceed "
            f"segment.max_duration ({cfg.max_duration})"
        )


def resolve_contained_dir(roots: list[str], candidate: str) -> str:
    """Return `candidate` normalized, or raise ValueError if it escapes `roots`.

    The directory need not exist yet (VSA creates it right after), so this is
    the moral equivalent of the dashboard's
    `resolveContainedFile` (packages/mcp-server/src/dashboard/media.ts) adapted
    to a not-yet-existing target:

    1. reject relative paths, NUL bytes and `..` segments outright
    2. lexical containment under some root
    3. re-check containment after resolving symlinks, so a symlinked component
       cannot smuggle writes outside the root

    Unlike `resolveContainedFile` this does NOT reject symlinks outright — only
    ones that resolve *outside* a permitted root. Pointing the segments dir at
    another volume (`~/.mcp-smart-community/segments -> /mnt/nvme/segments`) is
    a legitimate ops setup, and it stays contained under step 3.
    """
    if not roots:
        raise ValueError("no permitted data root is configured")
    if "\x00" in candidate:
        raise ValueError("path must not contain NUL bytes")
    if not os.path.isabs(candidate):
        raise ValueError("path must be absolute")
    if ".." in candidate.split(os.sep):
        raise ValueError("path must not contain '..' segments")

    lexical = os.path.normpath(candidate)
    lexical_roots = [os.path.normpath(r) for r in roots]

    def _contained(path: str, root: str) -> bool:
        # `commonpath` raises on mixed absolute/relative input; both are
        # absolute and normalized here. Require a strict descendant so the root
        # itself cannot be claimed as a source's data_dir.
        return path != root and os.path.commonpath([path, root]) == root

    if not any(_contained(lexical, r) for r in lexical_roots):
        raise ValueError("path escapes the permitted data root(s)")

    # `realpath` is non-strict: it resolves the symlinks in whatever prefix
    # exists and normalizes the rest lexically. That keeps a not-yet-created
    # root working (fresh install, before the first register creates it) while
    # still catching `<root>/link/pwn` where `link` points outside.
    real_candidate = os.path.realpath(lexical)
    real_roots = [os.path.realpath(r) for r in lexical_roots]
    if not any(_contained(real_candidate, r) for r in real_roots):
        raise ValueError("path escapes the permitted data root(s) after symlink resolution")

    return lexical


def resolve_contained_file(roots: list[str], candidate: str, kind: str) -> str:
    """Return `candidate` fully resolved, or raise ValueError if it escapes `roots`.

    Same job as `resolve_contained_dir`, for a file target that the caller is
    going to read rather than create, with two deliberate differences:

    * It resolves symlinks up front (`realpath`) and containment is checked
      once, against the resolved path. `resolve_contained_dir` has to check
      twice because its target does not exist yet, so the lexical pass is the
      only thing guarding the not-yet-created suffix. Existence is NOT required
      here either — `realpath` is non-strict, and callers already tolerate a
      missing model — so this does not become an existence oracle for paths
      that are inside a permitted root.
    * Containment is expressed as `startswith(root + os.sep)` rather than
      `commonpath(...) == root`. The two are equivalent (both require a strict
      descendant), but `str.startswith` is the only check CodeQL's
      `py/path-injection` state machine recognises as a `SafeAccessCheck` — see
      `Path::SafeAccessCheck::Range` in the Python library, whose sole
      implementation is `StartswithCall`.

    The RESOLVED path is returned and callers must use it: a
    validate-and-discard helper leaves the unnormalized value on the flow into
    the sink, so the pipeline would go on to load a path the check never
    actually approved.

    Used by the prefilter model registry to confine entries to `model_dir`.
    """
    if not roots:
        raise ValueError(f"no permitted {kind} root is configured")
    if "\x00" in candidate:
        raise ValueError("path must not contain NUL bytes")
    if not os.path.isabs(candidate):
        raise ValueError("path must be absolute")

    resolved = os.path.realpath(os.path.normpath(candidate))
    for root in roots:
        # `rstrip` then re-append so a root of `/` (or a trailing slash in
        # config) yields `/` rather than `//`, which nothing would match.
        prefix = os.path.realpath(os.path.normpath(root)).rstrip(os.sep) + os.sep
        if resolved.startswith(prefix):
            return resolved
    raise ValueError(f"path escapes the permitted {kind} root(s)")


def merge_config(defaults: ConfigModelT, override: ConfigModelT | None) -> ConfigModelT:
    """Merge explicitly-set override fields onto defaults."""
    if override is None:
        return defaults

    update = override.model_dump(exclude_unset=True)
    if not update:
        return defaults

    return defaults.model_copy(update=update)


def load_config(config_path: str | None = None) -> AppConfig:
    path = config_path or os.environ.get(
        "VIDEOSTREAM_CONFIG", str(Path("config/config.yaml.example"))
    )
    if os.path.isfile(path):
        with open(path) as f:
            raw = yaml.safe_load(f) or {}
        if not isinstance(raw, dict):
            raise ValueError(
                f"videostream-analytics config must be a YAML mapping at the "
                f"top level, got {type(raw).__name__}: {path}"
            )
        config = AppConfig(**raw)
        logger.info("Loaded configuration from %s", path)
    elif os.path.lexists(path):
        # Typically a directory bind-mounted over the config path (Docker
        # auto-creates a missing bind-mount source as a root-owned directory).
        raise IsADirectoryError(
            f"videostream-analytics config path exists but is not a readable "
            f"file: {path}. Point VIDEOSTREAM_CONFIG at a YAML file — run "
            f"videostream-analytics/setup_vsa.sh to seed one."
        )
    else:
        # Built-in defaults carry an empty prefilter registry, so say loudly
        # which path was looked for and how to fix it instead of silently
        # running with the prefilter effectively disabled.
        logger.warning(
            "videostream-analytics config not found at %s — falling back to "
            "built-in defaults (empty prefilter model registry). Run "
            "videostream-analytics/setup_vsa.sh to seed your own config, or "
            "copy config/config.yaml.example to that path.",
            path,
        )
        config = AppConfig()

    config.data_dir = expand_path(config.data_dir)
    config.allowed_data_roots = [expand_path(r) for r in config.allowed_data_roots]

    # PREFILTER_MODEL_DIR is the host path docker-compose bind-mounts read-only
    # at the same path in-container, so it is the one root every registered
    # model has to sit under. Resolve it before the registry paths below: those
    # commonly write `${PREFILTER_MODEL_DIR}/...`, and the container may not
    # carry the variable.
    if model_dir := os.environ.get("PREFILTER_MODEL_DIR"):
        config.model_dir = model_dir
    config.model_dir = expand_path(config.model_dir)
    if not config.model_dir or "$" in config.model_dir:
        # Empty value, or a placeholder with no variable behind it (bare host
        # run): fall back to the documented default root instead of leaving
        # every registry entry to fail containment against a literal "${...}".
        config.model_dir = expand_path(DEFAULT_MODEL_DIR)

    # Registry paths may use ${PREFILTER_MODEL_DIR} / ${HOME} / ~ placeholders,
    # mirroring the node side which already expands ${HOME} in monitor-yaml
    # paths. Substituting from the resolved value rather than leaving it to
    # expandvars keeps config.yaml working when the variable is not exported
    # at all. ${MODEL_DIR} is accepted as the legacy spelling.
    for entry in config.prefilter_models.values():
        entry.model_path = expand_path(
            entry.model_path.replace("${PREFILTER_MODEL_DIR}", config.model_dir)
            .replace("${MODEL_DIR}", config.model_dir)
        )

    # Environment variable overrides
    if webhook_url := os.environ.get("WEBHOOK_URL"):
        config.webhook.url = webhook_url

    # SMART_COMMUNITY_DATA_DIR is the MCP server's data root. VSA writes under its
    # `segments/` subdir so the DEFAULT output root lines up with the per-monitor
    # data_dir MCP sends in register_source bodies (<SMART_COMMUNITY_DATA_DIR>/
    # segments/<id>). An explicit `data_dir` in a register_source request still
    # takes precedence — see source_worker._resolve_data_dir. This supersedes the
    # old RECORDINGS_DIR override (Docker no longer sets that).
    if root := os.environ.get("SMART_COMMUNITY_DATA_DIR"):
        config.data_dir = os.path.join(expand_path(root), "segments")

    return config
