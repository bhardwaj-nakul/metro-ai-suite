"""Prefilter model registry validation.

The registry decides which models a monitor may select, and "registered" is not
the same as "selectable": every rule below keeps an entry out of the available
list and puts it in `rejected` with a reason instead. These tests pin each rule,
because a regression in any of them either hides a usable model or — worse —
lets an unusable one through to a running stream, where the failure surfaces as
a silently prefilter-less pipeline.

`inspect_model` is stubbed throughout: the real one needs OpenVINO and a genuine
IR, and the rules under test are about the registry, not about OpenVINO.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from shared import model_registry
from shared.config import AppConfig, PrefilterModelConfig
from shared.model_registry import ModelNotAvailable
from shared.model_registry import ModelShapeInfo


def _shape_info(**overrides) -> ModelShapeInfo:
    defaults = dict(
        class_names=["person", "knife"],
        labels_source="embedded",
        input_shape="[1,3,640,640]",
        output_shape="[1,6,8400]",
        is_detection=True,
    )
    defaults.update(overrides)
    return ModelShapeInfo(**defaults)


def _stub_inspect(info: ModelShapeInfo | None = None):
    return patch(
        "stream_monitor.pipeline.prefilter_yolo.inspect_model",
        return_value=_shape_info() if info is None else info,
    )


@pytest.fixture
def model_dir(tmp_path):
    root = tmp_path / "models"
    root.mkdir()
    return root


def _ir_pair(directory, stem="m1"):
    """Write a plausible IR pair and return the .xml path."""
    directory.mkdir(parents=True, exist_ok=True)
    xml = directory / f"{stem}.xml"
    xml.write_text("<net/>")
    (directory / f"{stem}.bin").write_bytes(b"\x00" * 16)
    return xml


def _config(model_dir, **entries) -> AppConfig:
    config = AppConfig(model_dir=str(model_dir))
    config.prefilter_models = {
        name: PrefilterModelConfig(**fields) for name, fields in entries.items()
    }
    return config


class TestValidationRules:
    def test_valid_entry_is_available(self, model_dir):
        xml = _ir_pair(model_dir / "anywhere" / "you" / "like")
        config = _config(model_dir, m1={"kind": "detection", "model_path": str(xml)})
        with _stub_inspect():
            available, rejected = model_registry.list_models(config)
        assert rejected == []
        assert available[0].name == "m1"
        assert available[0].backend == "openvino"
        assert available[0].class_names == ["person", "knife"]

    def test_unsupported_kind_is_rejected(self, model_dir):
        xml = _ir_pair(model_dir)
        config = _config(
            model_dir, m1={"kind": "classification", "model_path": str(xml)}
        )
        with _stub_inspect():
            available, rejected = model_registry.list_models(config)
        assert available == []
        assert "kind 'classification' is not supported" in rejected[0]["reason"]

    def test_unsupported_backend_is_rejected(self, model_dir):
        xml = _ir_pair(model_dir)
        config = _config(
            model_dir,
            m1={"kind": "detection", "backend": "tensorrt", "model_path": str(xml)},
        )
        with _stub_inspect():
            available, rejected = model_registry.list_models(config)
        assert available == []
        assert "backend 'tensorrt' is not supported" in rejected[0]["reason"]

    def test_path_outside_model_dir_is_rejected(self, model_dir, tmp_path):
        """Containment, not layout: outside the mount the container cannot read it."""
        outside = _ir_pair(tmp_path / "elsewhere")
        config = _config(model_dir, m1={"kind": "detection", "model_path": str(outside)})
        with _stub_inspect():
            available, rejected = model_registry.list_models(config)
        assert available == []
        assert "not under PREFILTER_MODEL_DIR" in rejected[0]["reason"]

    def test_any_depth_under_model_dir_is_accepted(self, model_dir):
        """How the tree is organized under model_dir is the user's business."""
        flat = _ir_pair(model_dir, stem="flat")
        deep = _ir_pair(model_dir / "a" / "b" / "c", stem="deep")
        config = _config(
            model_dir,
            flat={"kind": "detection", "model_path": str(flat)},
            deep={"kind": "detection", "model_path": str(deep)},
        )
        with _stub_inspect():
            available, rejected = model_registry.list_models(config)
        assert rejected == []
        assert sorted(m.name for m in available) == ["deep", "flat"]

    def test_missing_xml_is_rejected(self, model_dir):
        config = _config(
            model_dir,
            m1={"kind": "detection", "model_path": str(model_dir / "ghost.xml")},
        )
        with _stub_inspect():
            available, rejected = model_registry.list_models(config)
        assert available == []
        assert "ghost.xml" in rejected[0]["reason"]

    def test_missing_bin_is_rejected(self, model_dir):
        """Half a copied IR pair is a common mistake and must not look usable."""
        xml = model_dir / "half.xml"
        xml.write_text("<net/>")
        config = _config(model_dir, m1={"kind": "detection", "model_path": str(xml)})
        with _stub_inspect():
            available, rejected = model_registry.list_models(config)
        assert available == []
        assert "half.bin" in rejected[0]["reason"]

    def test_empty_bin_is_rejected(self, model_dir):
        xml = model_dir / "empty.xml"
        xml.write_text("<net/>")
        (model_dir / "empty.bin").write_bytes(b"")
        config = _config(model_dir, m1={"kind": "detection", "model_path": str(xml)})
        with _stub_inspect():
            available, rejected = model_registry.list_models(config)
        assert available == []
        assert "is empty" in rejected[0]["reason"]

    def test_non_xml_path_is_rejected(self, model_dir):
        onnx = model_dir / "m1.onnx"
        onnx.write_text("x")
        config = _config(model_dir, m1={"kind": "detection", "model_path": str(onnx)})
        with _stub_inspect():
            available, rejected = model_registry.list_models(config)
        assert available == []
        assert "expects an IR .xml" in rejected[0]["reason"]

    def test_unreadable_model_is_rejected(self, model_dir):
        xml = _ir_pair(model_dir)
        config = _config(model_dir, m1={"kind": "detection", "model_path": str(xml)})
        with patch(
            "stream_monitor.pipeline.prefilter_yolo.inspect_model", return_value=None
        ):
            available, rejected = model_registry.list_models(config)
        assert available == []
        assert "could not read" in rejected[0]["reason"]

    def test_non_detection_output_is_rejected(self, model_dir):
        """A classifier in a detection slot would decode as confident nonsense."""
        xml = _ir_pair(model_dir)
        config = _config(model_dir, m1={"kind": "detection", "model_path": str(xml)})
        info = _shape_info(
            is_detection=False,
            output_shape="[1,1000]",
            detection_error="expected a rank-3 detection output [1, 4+nc, anchors], got [1,1000]",
        )
        with _stub_inspect(info):
            available, rejected = model_registry.list_models(config)
        assert available == []
        assert "not a usable detection model" in rejected[0]["reason"]


class TestResolve:
    def test_resolve_returns_entry(self, model_dir):
        xml = _ir_pair(model_dir)
        config = _config(model_dir, m1={"kind": "detection", "model_path": str(xml)})
        with _stub_inspect():
            info = model_registry.resolve(config, "m1")
        assert info.model_path == str(xml)

    def test_resolve_unregistered_name_raises(self, model_dir):
        xml = _ir_pair(model_dir)
        config = _config(model_dir, m1={"kind": "detection", "model_path": str(xml)})
        with pytest.raises(ModelNotAvailable) as exc:
            model_registry.resolve(config, "nope")
        # The message names what IS registered, so the caller can correct itself.
        assert "m1" in str(exc.value)

    def test_resolve_registered_but_invalid_raises(self, model_dir):
        config = _config(
            model_dir,
            m1={"kind": "detection", "model_path": str(model_dir / "ghost.xml")},
        )
        with pytest.raises(ModelNotAvailable):
            model_registry.resolve(config, "m1")


class TestInspectionCache:
    def test_repeated_calls_inspect_once(self, model_dir):
        xml = _ir_pair(model_dir)
        config = _config(model_dir, m1={"kind": "detection", "model_path": str(xml)})
        with patch(
            "stream_monitor.pipeline.prefilter_yolo.inspect_model",
            return_value=_shape_info(),
        ) as inspect:
            model_registry.list_models(config)
            model_registry.list_models(config)
        assert inspect.call_count == 1

    def test_rewritten_model_is_reinspected(self, model_dir):
        """Keyed on the stat tuple, so swapping the file in place takes effect."""
        xml = _ir_pair(model_dir)
        config = _config(model_dir, m1={"kind": "detection", "model_path": str(xml)})
        with patch(
            "stream_monitor.pipeline.prefilter_yolo.inspect_model",
            side_effect=[
                _shape_info(class_names=["person"]),
                _shape_info(class_names=["cat", "dog"]),
            ],
        ) as inspect:
            first, _ = model_registry.list_models(config)
            xml.write_text("<net> rewritten with different labels </net>")
            second, _ = model_registry.list_models(config)
        assert inspect.call_count == 2
        assert first[0].class_names == ["person"]
        assert second[0].class_names == ["cat", "dog"]

    def test_cache_is_bounded(self, model_dir):
        """Repeated rewrites must not grow the cache without limit."""
        xml = _ir_pair(model_dir)
        config = _config(model_dir, m1={"kind": "detection", "model_path": str(xml)})
        with _stub_inspect():
            for i in range(model_registry._CACHE_MAX_ENTRIES + 5):
                xml.write_text(f"<net rev='{i}'/>")
                model_registry.list_models(config)
        assert len(model_registry._cache) <= model_registry._CACHE_MAX_ENTRIES

    def test_entry_metadata_edits_are_not_cached(self, model_dir):
        """Only the inspection result is cached — config edits still take effect."""
        xml = _ir_pair(model_dir)
        config = _config(
            model_dir,
            m1={"kind": "detection", "model_path": str(xml), "description": "first"},
        )
        with _stub_inspect():
            model_registry.list_models(config)
            config.prefilter_models["m1"].description = "second"
            available, _ = model_registry.list_models(config)
        assert available[0].description == "second"
