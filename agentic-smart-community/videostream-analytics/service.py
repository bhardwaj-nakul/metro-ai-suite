"""FastAPI application for videostream-analytics microservice."""

from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager, contextmanager
from typing import Annotated, Any
from urllib.parse import urlsplit

import yaml
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi import Path as PathParam
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from shared import model_registry
from shared.config import (
    SUPPORTED_MODEL_BACKENDS,
    SUPPORTED_MODEL_KINDS,
    AppConfig,
    SourceConfig,
    MotionConfig,
    SegmentConfig,
    StaticConfig,
    PrefilterConfig,
    RecordingConfig,
    RoiConfig,
    HealthConfig,
    KeepaliveConfig,
    SecurityConfig,
    load_config,
)
from shared.model_registry import ModelInfo, ModelNotAvailable
from source_worker import SourceManager

logger = logging.getLogger(__name__)

_manager: SourceManager | None = None
_reload_lock = threading.Lock()

# Same shape as the dashboard's `monitorIdSchema`
# (packages/mcp-server/src/dashboard/router.ts). A source_id reaches the
# filesystem via `<data_dir>/<source_id>`, so keeping the two sides identical
# means a monitor id that MCP accepts is exactly one VSA accepts.
SOURCE_ID_PATTERN = r"^[A-Za-z0-9_-]{1,128}$"

_MAX_URL_LEN = 2048
_MAX_PATH_LEN = 4096

# Path-parameter form of the same constraint. Applying it here means a
# traversal attempt like `/sources/..%2F..%2Ftmp` is refused with 422 before it
# can reach the registry lookup.
SourceIdPath = Annotated[str, PathParam(pattern=SOURCE_ID_PATTERN)]


def _reject_control_chars(value: str, field: str) -> str:
    """Reject NUL and other control characters.

    NUL in particular turns into a `ValueError` deep inside `os` calls, and
    control characters corrupt the log lines and the RESTler network log alike.
    """
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in value):
        raise ValueError(f"{field} must not contain control characters")
    return value


# --- Request Models (module-level for FastAPI schema resolution) ---


class PipelineConfig(BaseModel):
    """Nested pipeline configuration sent by MCP server.

    All sub-blocks optional — per-source defaults fill the gaps.
    """

    model_config = ConfigDict(extra="forbid")

    motion: MotionConfig | None = None
    segment: SegmentConfig | None = None
    static: StaticConfig | None = None
    prefilter: PrefilterConfig | None = None
    roi: RoiConfig | None = None
    recording: RecordingConfig | None = None
    health: HealthConfig | None = None
    keepalive: KeepaliveConfig | None = None


class RegisterSourceRequest(BaseModel):
    """`POST /register_source` body — must match MCP `analyticsRegister` exactly.

    Hard cutover from the old flat schema: `rtsp_url`, top-level `motion/...`,
    and `use_case` are no longer accepted. `extra="forbid"` makes drift fail
    loudly with 422 instead of silently dropping fields.
    """

    model_config = ConfigDict(extra="forbid")

    source_id: str = Field(pattern=SOURCE_ID_PATTERN)
    source_url: str = Field(min_length=1, max_length=_MAX_URL_LEN)
    webhook_url: str | None = Field(default=None, max_length=_MAX_URL_LEN)
    data_dir: str | None = Field(default=None, max_length=_MAX_PATH_LEN)
    pipeline: PipelineConfig = Field(default_factory=PipelineConfig)

    @field_validator("source_url")
    @classmethod
    def _check_source_url(cls, v: str) -> str:
        return _reject_control_chars(v.strip(), "source_url")

    @field_validator("webhook_url")
    @classmethod
    def _check_webhook_url(cls, v: str | None) -> str | None:
        """Require a plain http(s) URL — the sink POSTs events to it verbatim.

        Host-level restriction (private ranges only) is deliberately NOT here
        yet; this only rules out non-HTTP schemes and embedded credentials.
        """
        if v is None:
            return None
        v = _reject_control_chars(v.strip(), "webhook_url")
        parts = urlsplit(v)
        if parts.scheme not in ("http", "https"):
            raise ValueError("webhook_url must use the http or https scheme")
        if not parts.hostname:
            raise ValueError("webhook_url must include a host")
        if parts.username or parts.password:
            raise ValueError("webhook_url must not embed credentials")
        return v

    @field_validator("data_dir")
    @classmethod
    def _check_data_dir(cls, v: str | None) -> str | None:
        """Absolute paths only. Containment is enforced in SourceManager.

        Rejecting relative paths here is what turns the reported
        `data_dir: "fuzzstring"` 500 (PermissionError from `os.makedirs`
        relative to the service CWD) into a 422.
        """
        if v is None:
            return None
        v = _reject_control_chars(v.strip(), "data_dir")
        if not v:
            return None
        if not os.path.isabs(os.path.expanduser(v)):
            raise ValueError("data_dir must be an absolute path")
        return v


class UpdatePipelineRequest(BaseModel):
    """`PUT /sources/{id}/pipeline` body — nested form, no flat fallback."""

    model_config = ConfigDict(extra="forbid")

    pipeline: PipelineConfig = Field(default_factory=PipelineConfig)


def validate_source_url(url: str, security: SecurityConfig) -> None:
    """Reject a `source_url` whose scheme is not an allowed stream transport.

    `source_url` ends up as the argument to `ffmpeg -i` and to
    `cv2.VideoCapture(..., CAP_FFMPEG)`. ffmpeg will happily open `file:`,
    `concat:`, `subfile:`, `data:` and friends, mux the result into `data_dir`,
    and the MCP dashboard then serves that directory as mp4 clips — so an
    unrestricted scheme here is an arbitrary-file-read that exfiltrates over a
    supported API. Raises ValueError (-> 400) rather than HTTPException so the
    same check is usable outside the request path.
    """
    scheme = urlsplit(url).scheme.lower()
    if not scheme:
        raise ValueError(
            "source_url must include a scheme "
            f"({'/'.join(_effective_schemes(security))})"
        )
    if scheme not in _effective_schemes(security):
        raise ValueError(f"source_url scheme '{scheme}' is not allowed")


def _effective_schemes(security: SecurityConfig) -> tuple[str, ...]:
    schemes = [s.lower() for s in security.allowed_source_schemes]
    if security.allow_file_source:
        schemes.append("file")
    return tuple(dict.fromkeys(schemes))


def get_manager() -> SourceManager:
    if _manager is None:
        raise RuntimeError("SourceManager not initialized")
    return _manager


@contextmanager
def _guard(operation: str):
    """Turn business-layer failures into deliberate status codes.

    Any 500 produced by user input is an SDL bug, and the business layer raises
    plain `OSError`/`ValueError` for input it cannot honour (`os.makedirs` on an
    unwritable path, a `data_dir` outside the permitted roots, inverted segment
    durations). Those are the caller's fault → 400.

    `ConnectionError` is special-cased even though it is an `OSError` subclass:
    `ContinuousRecorder` raises it when ffmpeg is missing from PATH, which is a
    server-side environment defect, not a bad request → 503.

    The exception message is logged but NOT returned. Messages routinely embed
    absolute server paths (`Permission denied: '/home/.../segments'`), and this
    API has no authentication, so echoing them hands out reconnaissance.
    """
    try:
        yield
    except HTTPException:
        raise
    except ConnectionError as exc:
        logger.error("[%s] dependency unavailable: %s", operation, exc)
        raise HTTPException(
            status_code=503,
            detail={"error": "dependency_unavailable", "operation": operation},
        ) from exc
    except (OSError, ValueError) as exc:
        logger.warning(
            "[%s] rejected: %s: %s", operation, type(exc).__name__, exc
        )
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_request",
                "reason": type(exc).__name__,
                "operation": operation,
            },
        ) from exc


def _available_devices() -> list[str]:
    """Best-effort list of OpenVINO inference devices; ``["CPU"]`` on failure."""
    try:
        import openvino as ov

        return list(ov.Core().available_devices) or ["CPU"]
    except Exception:
        return ["CPU"]


def resolve_default_prefilter_model(config: AppConfig) -> None:
    """Fill ``defaults.prefilter.model_path`` from the registry.

    Sources that omit `prefilter` entirely inherit `defaults.prefilter`
    wholesale, so the default's path has to be resolved once up front rather
    than per request. Fail-soft: an unusable default is logged and leaves the
    path empty, which `_init_prefilter` already treats as "no prefilter" — one
    bad registry entry must not stop the service from serving other monitors.
    """
    name = config.defaults.prefilter.model
    if not name:
        return
    try:
        config.defaults.prefilter.model_path = model_registry.resolve(
            config, name
        ).model_path
    except ModelNotAvailable as e:
        logger.warning("default prefilter model %r is unavailable: %s", name, e)


_CONFIG_WATCH_INTERVAL_S = 2.0
_CONFIG_WATCH_DEBOUNCE_S = 0.5


def _reload_candidate(app: FastAPI) -> str | None:
    """Prefer the rename-safe ``--reload-config`` view; fall back to ``--config``."""
    for path in (app.state.reload_path, app.state.config_path):
        if path and os.path.isfile(path):
            return path
    return None


def _apply_reload(app: FastAPI, candidate: str) -> dict[str, Any]:
    """Load ``candidate`` and swap it into the shared AppConfig.

    Raises (yaml.YAMLError, ValueError, ValidationError) on an unreadable or
    invalid file; the running config is untouched in that case.
    """
    config: AppConfig = app.state.config
    new_config = load_config(candidate)
    # Resolve before the swap: sources that omit `prefilter` inherit the
    # default's model_path, and a freshly loaded config carries it empty. Doing
    # this after the swap leaves a window (a registry read_model on a new file)
    # in which such a registration is permanently prefilter-less.
    resolve_default_prefilter_model(new_config)
    with _reload_lock:
        # Every consumer — the endpoints' closure, app.state.config and
        # SourceManager.config — holds this one object, so swapping its
        # contents in place reaches all of them.
        config.__dict__.update(new_config.__dict__)
        config.__pydantic_fields_set__ = new_config.__pydantic_fields_set__
        get_manager().on_config_reloaded()
    logger.info("configuration reloaded from %s", candidate)
    available, rejected = model_registry.list_models(config)
    return {
        "status": "reloaded",
        "path": candidate,
        "models": [m.name for m in available],
        "rejected": rejected,
    }


def _config_watch_loop(app: FastAPI, stop: threading.Event) -> None:
    """Auto-reload when the config file changes.

    One ``os.stat`` per interval — far below the cost of the service's other
    periodic work. The parse + registry validation only runs on an actual
    change; a broken file is logged and the running config kept, with the next
    edit triggering a retry.
    """
    last: tuple[str | None, int | None] | None = None

    def _snapshot() -> tuple[str | None, int | None]:
        candidate = _reload_candidate(app)
        try:
            return (candidate, os.stat(candidate).st_mtime_ns if candidate else None)
        except OSError:
            return (candidate, None)

    # Prime before the first wait so an edit landing between startup load and
    # the first tick is seen as a change, not silently adopted as the baseline.
    last = _snapshot()
    while not stop.wait(_CONFIG_WATCH_INTERVAL_S):
        current = _snapshot()
        if current == last:
            continue
        last = current
        candidate, mtime = current
        if candidate is None or mtime is None:
            continue
        if stop.wait(_CONFIG_WATCH_DEBOUNCE_S):  # let atomic writes settle
            break
        try:
            _apply_reload(app, candidate)
        except Exception as e:  # endpoint contract: keep the running config
            logger.warning("config auto-reload failed; keeping running config: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _manager
    config: AppConfig = app.state.config
    resolve_default_prefilter_model(config)
    _manager = SourceManager(config)
    watch_stop = threading.Event()
    watcher = threading.Thread(
        target=_config_watch_loop,
        args=(app, watch_stop),
        name="config-watch",
        daemon=True,
    )
    watcher.start()
    logger.info("videostream-analytics started on :%d", config.server.port)
    yield
    watch_stop.set()
    watcher.join(timeout=_CONFIG_WATCH_INTERVAL_S + 1)
    _manager.stop_all()
    logger.info("videostream-analytics shut down")


def create_app(
    config: AppConfig,
    config_path: str | None = None,
    reload_path: str | None = None,
) -> FastAPI:
    app = FastAPI(
        title="videostream-analytics",
        version="0.1.0",
        description="Smart Community video stream analytics microservice",
        lifespan=lifespan,
    )
    app.state.config = config
    app.state.config_path = config_path
    app.state.reload_path = reload_path

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ):
        """Surface pydantic ValidationError as 422 with the offending fields."""
        errors = exc.errors()
        unknown_fields = [
            ".".join(str(p) for p in e.get("loc", []) if p != "body")
            for e in errors
            if e.get("type") == "extra_forbidden"
        ]
        # pydantic v2 puts the live exception object in `ctx["error"]` for any
        # error raised by a `field_validator`/`model_validator`, and `url` is a
        # docs link. Neither is JSON-serializable/useful — passing the raw list
        # to JSONResponse turns a 422 into a 500 inside the encoder. `msg`
        # already carries the validator's text.
        safe_errors = [
            {k: v for k, v in e.items() if k not in ("ctx", "url")} for e in errors
        ]
        return JSONResponse(
            status_code=422,
            content={
                "detail": jsonable_encoder(safe_errors),
                "unknown_fields": unknown_fields,
                "hint": (
                    "request body must match the nested-pipeline schema "
                    "(source_id/source_url/webhook_url/data_dir/pipeline.{motion,segment,prefilter,recording,health})"
                ),
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        """Log the traceback, return a body with nothing server-side in it.

        Anything reaching here is a genuine defect (the deliberate 400/503
        cases go through `_guard`), so it must be loud in the log and opaque on
        the wire.
        """
        logger.exception(
            "unhandled error on %s %s", request.method, request.url.path
        )
        return JSONResponse(
            status_code=500, content={"error": "internal_error"}
        )

    # --- Endpoints ---
    #
    # Every endpoint that touches SourceManager is declared `def`, NOT
    # `async def`. The manager is synchronous and blocking: `StreamPipeline.stop`
    # (rtsp_monitor.py) and `ContinuousRecorder.stop` (continuous_recorder.py)
    # each `join(timeout=10)` a worker thread that may be parked in
    # `cap.read()`/ffmpeg. Under `async def` those 10-20 seconds run ON the
    # event loop, so one DELETE stalls *every* concurrent request — the origin
    # of the fuzz run's timeout findings. A plain `def` makes FastAPI dispatch
    # the call to its threadpool, keeping the loop free.
    #
    # This is why SourceManager is internally locked: with `def` endpoints the
    # requests genuinely run in parallel.

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": "videostream-analytics"}

    @app.get("/capabilities/prefilter")
    async def prefilter_capabilities(
        model: Annotated[str | None, Query(max_length=128)] = None,
    ) -> dict[str, Any]:
        """Advertise the selectable prefilter models and their ``target_classes``.

        ``models`` holds every registry entry that validates — those are the
        values ``pipeline.prefilter.model`` accepts. ``rejected`` is an operator
        diagnostic: registered entries that cannot be used, with the reason.
        Entries listed there are not selectable.

        A class list is only as good as its source: ``labels_source`` is
        ``embedded`` when the names came from the model's own ``rt_info``, and
        ``fallback_coco``/``unavailable`` when they are a COCO-80 guess that
        callers should confirm rather than trust.

        With ``?model=<name>`` the response is that one entry's detail instead.
        """
        available, rejected = model_registry.list_models(config)
        if model is not None:
            for info in available:
                if info.name == model:
                    return info.to_dict()
            reason = next(
                (r["reason"] for r in rejected if r["name"] == model),
                f"prefilter model '{model}' is not registered",
            )
            raise HTTPException(
                status_code=404,
                detail={"error": "model_not_available", "model": model, "reason": reason},
            )

        pf = config.defaults.prefilter
        return {
            "default_model": pf.model,
            "supported_kinds": list(SUPPORTED_MODEL_KINDS),
            "supported_backends": list(SUPPORTED_MODEL_BACKENDS),
            "available_devices": _available_devices(),
            "models": [m.to_dict() for m in available],
            "rejected": rejected,
            # The deployment-default prefilter block, for callers that merge it
            # under per-monitor overrides (the use-case manager skill does).
            "defaults": pf.model_dump(),
        }

    @app.post("/config/reload")
    async def reload_configuration() -> dict[str, Any]:
        """Re-read the configuration file and swap it in without a restart.

        Running sources are untouched — their pipelines were merged at
        registration. The reloaded config applies to new registrations,
        ``PUT /sources/{id}/pipeline`` updates, ``/capabilities/prefilter``
        and the default webhook sink.

        Reads ``--reload-config`` when it exists (a rename-safe directory
        bind-mount view of the same file — single-file mounts pin the inode
        the container started with, so atomic-save edits never show up
        through them), else the startup ``--config`` path. A missing or
        invalid file keeps the running config: falling back to built-in
        defaults here would silently empty the model registry.
        """
        candidate = _reload_candidate(app)
        if candidate is None:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "config_not_found",
                    "path": app.state.reload_path or app.state.config_path or "",
                    "hint": "the running config is kept; point --reload-config "
                            "at the live configuration file",
                },
            )
        try:
            return _apply_reload(app, candidate)
        except (yaml.YAMLError, ValueError, ValidationError) as e:
            raise HTTPException(
                status_code=422,
                detail={"error": "config_invalid", "path": candidate, "detail": str(e)},
            ) from e

    def _reject_request_model_path(prefilter: PrefilterConfig | None) -> None:
        """A request may not carry ``model_path`` — models are chosen by name.

        Call this on the request as received: assigning a resolved path back
        onto the model afterwards marks the field as set.
        """
        if prefilter is not None and "model_path" in prefilter.model_fields_set:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "model_path is not accepted",
                    "hint": "select a registered model by name with pipeline.prefilter.model; "
                            "GET /capabilities/prefilter lists the registered models",
                },
            )

    def _lookup_prefilter_model(name: str) -> ModelInfo | None:
        """Look a registry name up. ``None`` for an empty name; 422 if unusable."""
        if not name:
            return None
        try:
            return model_registry.resolve(config, name)
        except ModelNotAvailable as e:
            # The rejection reason embeds absolute server paths, and this API has
            # no authentication — log it, and answer with the selectable names
            # only. `GET /capabilities/prefilter` is where reasons are reported.
            logger.warning("prefilter model %r unavailable: %s", name, e)
            available, _ = model_registry.list_models(config)
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "model_not_available",
                    "model": name,
                    "models": [m.name for m in available],
                    "hint": "GET /capabilities/prefilter reports why a registered "
                            "model is unavailable",
                },
            ) from e

    def resolve_prefilter_model(
        prefilter: PrefilterConfig | None, current_model: str = ""
    ) -> ModelInfo | None:
        """Resolve the effective ``prefilter.model`` against the registry.

        Effective name is the requested one, else the source's current one
        (`current_model`, supplied by `update_pipeline`), else the deployment
        default. Writes the entry's validated path onto ``prefilter`` so the
        running pipeline (rtsp_monitor._init_prefilter) loads it, and returns
        the entry for `_validate_target_classes`. ``None`` means no model is in
        play — nothing registered under any of those names.

        A request may not carry ``model_path``: the whole point of the registry
        is that paths come from config, so accepting one would reopen an
        unauthenticated path into `read_model()`.

        Raises HTTPException(422) for a rejected or unknown key.
        """
        _reject_request_model_path(prefilter)
        requested = prefilter.model if prefilter and prefilter.model else ""
        info = _lookup_prefilter_model(requested or current_model or config.defaults.prefilter.model)
        if info is not None and prefilter is not None:
            prefilter.model = info.name
            prefilter.model_path = info.model_path
        return info

    def _validate_target_classes(
        prefilter: PrefilterConfig | None, model: ModelInfo | None
    ) -> None:
        """Reject ``target_classes`` not in the model's embedded label set.

        Only hard-fails when labels are trustworthy (``embedded``); a
        ``fallback_coco``/``unavailable`` label set is a guess, so we let the
        request through rather than block on an untrusted list.
        """
        if not prefilter or not prefilter.enabled or not prefilter.target_classes:
            return
        if model is None or model.labels_source != "embedded":
            return
        unknown = [c for c in prefilter.target_classes if c not in model.class_names]
        if unknown:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "unknown target_classes",
                    "unknown": unknown,
                    "class_names": model.class_names,
                },
            )

    @app.get("/sources")
    def list_sources() -> list[dict[str, Any]]:
        """Return a bare array — MCP `monitor-ctl.ts` indexes by `s.source_id`."""
        mgr = get_manager()
        return mgr.get_sources()

    def _source_status(source_id: str) -> dict[str, Any]:
        mgr = get_manager()
        status = mgr.get_source_status(source_id)
        if status is None:
            raise HTTPException(status_code=404, detail=f"Source not found: {source_id}")
        return status

    @app.get("/sources/{source_id}")
    def get_source(source_id: SourceIdPath) -> dict[str, Any]:
        return _source_status(source_id)

    @app.get("/sources/{source_id}/status")
    def get_source_status(source_id: SourceIdPath) -> dict[str, Any]:
        """MCP's `analyticsSourceExists` calls this path."""
        return _source_status(source_id)

    @app.get("/sources/{source_id}/pipeline")
    def get_source_pipeline(source_id: SourceIdPath) -> dict[str, Any]:
        """The source's effective (merged) pipeline configuration.

        Answers "what is this monitor actually running": every block is the
        per-source value merged over the deployment defaults, so a source that
        never configured `prefilter` shows the inherited default here.
        """
        mgr = get_manager()
        result = mgr.get_source_pipeline(source_id)
        if result is None:
            raise HTTPException(status_code=404, detail=f"Source not found: {source_id}")
        return result

    @app.post("/register_source")
    def register_source(req: RegisterSourceRequest) -> dict[str, Any]:
        mgr = get_manager()
        with _guard("register_source"):
            validate_source_url(req.source_url, config.security)
            model = resolve_prefilter_model(req.pipeline.prefilter)
            _validate_target_classes(req.pipeline.prefilter, model)
        source = SourceConfig(
            source_id=req.source_id,
            source_url=req.source_url,
            webhook_url=req.webhook_url,
            data_dir=req.data_dir,
            motion=req.pipeline.motion,
            segment=req.pipeline.segment,
            static=req.pipeline.static,
            prefilter=req.pipeline.prefilter,
            roi=req.pipeline.roi,
            recording=req.pipeline.recording,
            health=req.pipeline.health,
            keepalive=req.pipeline.keepalive,
        )
        with _guard("register_source"):
            result = mgr.register_source(source)
        if result["status"] == "registration_in_progress":
            # Another request is mid-build for this id. Refusing beats queueing:
            # the loser would hold a threadpool worker through a 20s teardown.
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "registration_in_progress",
                    "source_id": req.source_id,
                },
            )
        return result

    @app.post("/sources/{source_id}/stop")
    def stop_source(source_id: SourceIdPath) -> dict[str, Any]:
        mgr = get_manager()
        with _guard("stop_source"):
            result = mgr.unregister_source(source_id)
        if result["status"] == "not_found":
            raise HTTPException(status_code=404, detail=f"Source not found: {source_id}")
        return result

    @app.post("/sources/{source_id}/restart")
    def restart_source(source_id: SourceIdPath) -> dict[str, Any]:
        mgr = get_manager()
        with _guard("restart_source"):
            result = mgr.restart_source(source_id)
        if result["status"] == "not_found":
            raise HTTPException(status_code=404, detail=f"Source not found: {source_id}")
        return result

    @app.post("/sources/{source_id}/pause")
    def pause_source(source_id: SourceIdPath) -> dict[str, Any]:
        mgr = get_manager()
        with _guard("pause_source"):
            result = mgr.pause_source(source_id)
        if result["status"] == "not_found":
            raise HTTPException(status_code=404, detail=f"Source not found: {source_id}")
        return result

    @app.post("/sources/{source_id}/resume")
    def resume_source(source_id: SourceIdPath) -> dict[str, Any]:
        mgr = get_manager()
        with _guard("resume_source"):
            result = mgr.resume_source(source_id)
        if result["status"] == "not_found":
            raise HTTPException(status_code=404, detail=f"Source not found: {source_id}")
        return result

    @app.post("/sources/{source_id}/keepalive")
    def keepalive_source(source_id: SourceIdPath) -> dict[str, Any]:
        """MCP server pings this every ~30s while monitor is online.

        Body is ignored (may be empty). Watchdog auto-pauses the source if no
        keepalive arrives within `pipeline.keepalive.timeout_seconds`.
        """
        mgr = get_manager()
        result = mgr.keepalive_source(source_id)
        if result["status"] == "not_found":
            raise HTTPException(status_code=404, detail=f"Source not found: {source_id}")
        return result

    def validate_effective_prefilter(source_id: str, pipeline: PipelineConfig) -> PrefilterConfig:
        """Validate the prefilter a source would run after ``pipeline`` is applied.

        Effective config = deployment defaults, then the source's current
        values, then the request. The model is looked up in the registry (only
        when prefilter is enabled — turning it off must always be possible).
        """
        _reject_request_model_path(pipeline.prefilter)
        status = get_manager().get_source_status(source_id)
        if status is None:
            raise HTTPException(status_code=404, detail=f"Source not found: {source_id}")
        current = status.get("pipeline_config", {})
        values = config.defaults.prefilter.model_dump() | current.get("prefilter", {})
        if pipeline.prefilter is not None:
            values.update(pipeline.prefilter.model_dump(exclude_unset=True))
        effective = PrefilterConfig.model_validate(values)
        if effective.enabled:
            model = _lookup_prefilter_model(effective.model or config.defaults.prefilter.model)
            if model is not None:
                effective.model, effective.model_path = model.name, model.model_path
            _validate_target_classes(effective, model)
            if effective.device not in _available_devices():
                raise HTTPException(status_code=422, detail="unsupported prefilter device")
        roi = config.defaults.roi.model_dump() | current.get("roi", {})
        if pipeline.roi is not None:
            roi.update(pipeline.roi.model_dump(exclude_unset=True))
        if roi.get("enabled") and not effective.enabled:
            raise HTTPException(status_code=422, detail="ROI requires prefilter")
        return effective

    @app.post("/sources/{source_id}/pipeline/validate")
    def validate_pipeline(source_id: SourceIdPath, req: UpdatePipelineRequest) -> dict[str, Any]:
        """Validate a candidate without stopping or changing the source."""
        with _guard("validate_pipeline"):
            effective = validate_effective_prefilter(source_id, req.pipeline)
        return {"valid": True, "prefilter": effective.model_dump()}

    @app.put("/sources/{source_id}/pipeline")
    def update_pipeline(
        source_id: SourceIdPath, req: UpdatePipelineRequest
    ) -> dict[str, Any]:
        mgr = get_manager()
        with _guard("update_pipeline"):
            if req.pipeline.prefilter is not None or req.pipeline.roi is not None:
                validate_effective_prefilter(source_id, req.pipeline)
            if req.pipeline.prefilter is not None:
                # Point the update at the registry entry's validated path, and
                # keep a partial update on the source's own model. Must follow
                # the validation above, which checks the request as received.
                resolve_prefilter_model(
                    req.pipeline.prefilter, mgr.get_source_prefilter_model(source_id)
                )
            result = mgr.update_pipeline_config(
                source_id=source_id,
                motion=req.pipeline.motion,
                segment=req.pipeline.segment,
                prefilter=req.pipeline.prefilter,
                roi=req.pipeline.roi,
                recording=req.pipeline.recording,
                health=req.pipeline.health,
            )
        if result["status"] == "not_found":
            raise HTTPException(status_code=404, detail=f"Source not found: {source_id}")
        return result

    @app.delete("/sources/{source_id}")
    def delete_source(source_id: SourceIdPath) -> dict[str, Any]:
        mgr = get_manager()
        with _guard("delete_source"):
            result = mgr.unregister_source(source_id)
        if result["status"] == "not_found":
            raise HTTPException(status_code=404, detail=f"Source not found: {source_id}")
        return result

    return app
