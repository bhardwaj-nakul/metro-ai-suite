"""Prefilter model registry — the allowlist of selectable prefilter models.

A monitor names a model by registry key (`prefilter.model`), never by path. The
keys come from `prefilter_models` in config.yaml, so every path that reaches
`openvino.Core().read_model()` is deployment-authored rather than
request-supplied.

Registration alone does not make a model selectable. An entry must also pass
every check in `_validate`, and only entries that do are returned as available;
the rest come back as rejections carrying the reason, which is what
`GET /capabilities/prefilter` reports to operators. A typo, a half-copied IR
pair, or a model whose output is not a detection tensor is therefore visible as
a diagnostic instead of surfacing later as a stream that silently runs without
a prefilter.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field

from shared.config import (
    SUPPORTED_MODEL_BACKENDS,
    SUPPORTED_MODEL_KINDS,
    AppConfig,
    PrefilterModelConfig,
    resolve_contained_file,
)

logger = logging.getLogger(__name__)


@dataclass
class ModelShapeInfo:
    """What a capability query / load-time self-check needs to know about an IR.

    Produced by the backend's inspector (e.g. prefilter_yolo.inspect_model),
    consumed here by registry validation.
    """

    class_names: list[str]
    labels_source: str
    input_shape: str
    output_shape: str
    # Whether the output decodes as YOLO detection: rank 3, [1, 4+nc, anchors].
    # _postprocess assumes exactly that layout and would otherwise read a
    # classification or pose tensor as boxes, yielding plausible-looking noise.
    is_detection: bool
    detection_error: str = ""


@dataclass
class ModelInfo:
    """A registry entry that passed validation, plus what inspection found."""

    name: str
    kind: str
    backend: str
    model_path: str
    description: str = ""
    class_names: list[str] = field(default_factory=list)
    labels_source: str = "unavailable"
    input_shape: str = "unknown"
    output_shape: str = "unknown"

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "kind": self.kind,
            "backend": self.backend,
            "model_path": self.model_path,
            "description": self.description,
            "class_names": self.class_names,
            "labels_source": self.labels_source,
            "input_shape": self.input_shape,
            "output_shape": self.output_shape,
        }


class ModelNotAvailable(ValueError):
    """Raised by `resolve` for an unregistered or non-validating key."""


# Validated entries keyed by (model_path, mtime_ns, size). `/capabilities/prefilter`
# is a conversational tool call an agent may make repeatedly while helping a user
# pick a model, and read_model on every entry each time is wasted work. Keying on
# the stat tuple means replacing a model file on disk invalidates its entry without
# a service restart.
_cache: dict[tuple[str, int, int], ModelInfo] = {}

# Each rewrite of a model file adds a key, so in a service that stays up for
# weeks the superseded ones would accumulate. There is no recency to preserve —
# a dropped entry costs one re-inspection — so drop the lot at the ceiling
# rather than carry LRU bookkeeping for a dict that holds a handful of models.
_CACHE_MAX_ENTRIES = 64


def _stat_key(path: str) -> tuple[str, int, int] | None:
    try:
        st = os.stat(path)
    except OSError:
        return None
    return (path, st.st_mtime_ns, st.st_size)


def _validate_openvino(
    name: str, entry: PrefilterModelConfig, resolved_path: str
) -> ModelInfo:
    """OpenVINO-specific checks: IR pair on disk, readable, detection-shaped."""
    if not resolved_path.endswith(".xml"):
        raise ModelNotAvailable(
            f"backend 'openvino' expects an IR .xml, got {resolved_path}"
        )
    weights = resolved_path[: -len(".xml")] + ".bin"
    for required in (resolved_path, weights):
        try:
            if os.path.getsize(required) == 0:
                raise ModelNotAvailable(f"{required} is empty")
        except OSError as e:
            raise ModelNotAvailable(f"cannot read {required}: {e.strerror or e}") from e

    stat_key = _stat_key(resolved_path)
    if stat_key is not None and stat_key in _cache:
        cached = _cache[stat_key]
        # Reuse only the inspection result; the entry's own metadata may have
        # been edited in config.yaml since.
        return ModelInfo(
            name=name,
            kind=entry.kind,
            backend=entry.backend,
            model_path=resolved_path,
            description=entry.description,
            class_names=cached.class_names,
            labels_source=cached.labels_source,
            input_shape=cached.input_shape,
            output_shape=cached.output_shape,
        )

    from stream_monitor.pipeline.prefilter_yolo import inspect_model

    info = inspect_model(resolved_path)
    if info is None:
        raise ModelNotAvailable(f"openvino could not read {resolved_path}")
    if not info.is_detection:
        raise ModelNotAvailable(
            f"not a usable detection model: {info.detection_error}"
        )

    resolved = ModelInfo(
        name=name,
        kind=entry.kind,
        backend=entry.backend,
        model_path=resolved_path,
        description=entry.description,
        class_names=info.class_names,
        labels_source=info.labels_source,
        input_shape=info.input_shape,
        output_shape=info.output_shape,
    )
    if stat_key is not None:
        if len(_cache) >= _CACHE_MAX_ENTRIES:
            _cache.clear()
        _cache[stat_key] = resolved
    return resolved


# Per-backend validators. The checks above this table (kind, backend,
# containment) are backend-agnostic and stay shared when a second entry lands.
_VALIDATORS = {"openvino": _validate_openvino}


def _validate(config: AppConfig, name: str, entry: PrefilterModelConfig) -> ModelInfo:
    if entry.kind not in SUPPORTED_MODEL_KINDS:
        raise ModelNotAvailable(
            f"kind '{entry.kind}' is not supported "
            f"(supported: {', '.join(SUPPORTED_MODEL_KINDS)})"
        )
    if entry.backend not in SUPPORTED_MODEL_BACKENDS:
        raise ModelNotAvailable(
            f"backend '{entry.backend}' is not supported "
            f"(supported: {', '.join(SUPPORTED_MODEL_BACKENDS)})"
        )

    # Containment under model_dir, not a directory convention: how the tree is
    # organized below it is the user's business. The rule exists because
    # docker-compose mounts exactly that root into the container, so a path
    # outside it is unreadable at runtime however valid it looks on the host.
    try:
        resolved_path = resolve_contained_file(
            [config.model_dir], entry.model_path, "model"
        )
    except ValueError as e:
        raise ModelNotAvailable(
            f"{entry.model_path} is not under PREFILTER_MODEL_DIR ({config.model_dir}): {e}"
        ) from e

    return _VALIDATORS[entry.backend](name, entry, resolved_path)


def list_models(config: AppConfig) -> tuple[list[ModelInfo], list[dict]]:
    """Split the registry into selectable models and rejections with reasons."""
    available: list[ModelInfo] = []
    rejected: list[dict] = []
    for name, entry in config.prefilter_models.items():
        try:
            available.append(_validate(config, name, entry))
        except ModelNotAvailable as e:
            rejected.append(
                {"name": name, "model_path": entry.model_path, "reason": str(e)}
            )
    return available, rejected


def resolve(config: AppConfig, name: str) -> ModelInfo:
    """Return the validated entry for `name`, or raise `ModelNotAvailable`."""
    entry = config.prefilter_models.get(name)
    if entry is None:
        known = ", ".join(sorted(config.prefilter_models)) or "<none registered>"
        raise ModelNotAvailable(
            f"prefilter model '{name}' is not registered (registered: {known})"
        )
    return _validate(config, name, entry)
