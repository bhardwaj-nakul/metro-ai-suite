"""Tests for configuration loading and validation."""

import logging
import os
from pathlib import Path
from unittest.mock import patch

import pytest
import yaml

from pydantic import ValidationError

from shared.config import (
    AppConfig,
    HealthConfig,
    MotionConfig,
    PrefilterConfig,
    RecordingConfig,
    RoiConfig,
    SegmentConfig,
    WebhookConfig,
    SourceConfig,
    expand_path,
    load_config,
    merge_config,
    validate_effective_segment,
)

from tests.conftest import FIXTURES_DIR


class TestExpandPath:
    def test_expand_tilde(self):
        result = expand_path("~/foo/bar")
        assert result == os.path.expanduser("~/foo/bar")
        assert "~" not in result

    def test_expand_env_var(self):
        with patch.dict(os.environ, {"MY_TEST_DIR": "/opt/test"}):
            result = expand_path("$MY_TEST_DIR/data")
            assert result == "/opt/test/data"

    def test_expand_home_env(self):
        result = expand_path("$HOME/videos")
        assert result == os.environ["HOME"] + "/videos"


class TestLoadConfig:
    def test_load_from_valid_yaml(self):
        config = load_config(str(FIXTURES_DIR / "test_config.yaml"))
        assert config.server.host == "127.0.0.1"
        assert config.server.port == 8999
        assert config.webhook.url == "http://localhost:9999/events"
        assert config.webhook.timeout == 5
        assert config.webhook.retry_attempts == 2
        assert config.defaults.motion.diff_threshold == 25

    def test_load_nonexistent_returns_defaults(self):
        config = load_config("/nonexistent/path/config.yaml")
        assert config.server.port == 8999
        # Loopback by default — the service is unauthenticated, so it must not
        # be reachable from other hosts unless a deployment opts in.
        assert config.server.host == "127.0.0.1"
        assert config.webhook.url == "http://localhost:3101/events"

    def test_load_nonexistent_logs_warning(self, caplog):
        # The built-in defaults carry an empty prefilter registry, so a missing
        # file must not fall back silently.
        with caplog.at_level(logging.WARNING, logger="shared.config"):
            config = load_config("/nonexistent/path/config.yaml")
        assert config.prefilter_models == {}
        assert any(
            r.levelno == logging.WARNING and "/nonexistent/path/config.yaml" in r.message
            for r in caplog.records
        )

    def test_load_directory_path_raises_with_path_in_message(self, tmp_path):
        # Docker auto-creates a missing bind-mount source as a directory; that
        # failure mode must name the path, not crash with a bare IsADirectoryError.
        with pytest.raises(IsADirectoryError, match=str(tmp_path)):
            load_config(str(tmp_path))

    def test_default_path_loads_shipped_example(self, monkeypatch, caplog):
        # The code default must point at the tracked template — a rename that
        # misses this reference turns every default startup into the warning path.
        root = Path(__file__).resolve().parents[2]
        example = root / "config" / "config.yaml.example"
        assert example.is_file(), "shipped config template must exist"
        monkeypatch.chdir(root)
        monkeypatch.delenv("VIDEOSTREAM_CONFIG", raising=False)
        with caplog.at_level(logging.WARNING, logger="shared.config"):
            config = load_config()
        assert "yolo11s" in config.prefilter_models
        assert not [r for r in caplog.records if r.levelno >= logging.WARNING]

    def test_example_registry_path_expands_under_model_dir(self, monkeypatch):
        root = Path(__file__).resolve().parents[2]
        monkeypatch.setenv("PREFILTER_MODEL_DIR", "/models/openvino")
        config = load_config(str(root / "config" / "config.yaml.example"))
        assert (
            config.prefilter_models["yolo11s"].model_path
            == "/models/openvino/yolo11s/FP16/yolo11s.xml"
        )

    def test_load_from_env_var(self, tmp_path):
        cfg_file = tmp_path / "env_config.yaml"
        cfg_file.write_text('model_dir: "/tmp/models"\nserver:\n  port: 7777\n')
        with patch.dict(os.environ, {"VIDEOSTREAM_CONFIG": str(cfg_file)}):
            config = load_config(None)
            assert config.server.port == 7777

    def test_data_dir_expanded(self):
        # Isolate from shell-exported SMART_COMMUNITY_DATA_DIR to verify YAML expansion.
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SMART_COMMUNITY_DATA_DIR", None)
            config = load_config(str(FIXTURES_DIR / "test_config.yaml"))
        assert "~" not in config.data_dir
        assert config.data_dir == "/tmp/videostream-test-data"

    def _registry_config(self, tmp_path, name, model_path, extra="", model_dir="/tmp/models"):
        cfg_file = tmp_path / f"{name}.yaml"
        cfg_file.write_text(
            f'model_dir: "{model_dir}"\n'
            f"{extra}"
            "prefilter_models:\n"
            "  yolo11s:\n"
            "    kind: detection\n"
            f"    model_path: {model_path}\n"
            "defaults:\n"
            "  prefilter:\n"
            "    enabled: true\n"
            "    model: yolo11s\n"
        )
        return str(cfg_file)

    def test_registry_model_path_env_var_expanded(self, tmp_path):
        cfg = self._registry_config(
            tmp_path, "mp_env", '"${HOME}/models/yolo11s.xml"'
        )
        config = load_config(cfg)
        resolved = config.prefilter_models["yolo11s"].model_path
        assert "$" not in resolved
        assert resolved == os.path.expanduser("~/models/yolo11s.xml")

    def test_registry_model_path_tilde_expanded(self, tmp_path):
        cfg = self._registry_config(tmp_path, "mp_tilde", "~/models/yolo11s.xml")
        config = load_config(cfg)
        resolved = config.prefilter_models["yolo11s"].model_path
        assert "~" not in resolved
        assert resolved == os.path.expanduser("~/models/yolo11s.xml")

    def test_registry_model_dir_placeholder_expanded(self, tmp_path):
        """`${PREFILTER_MODEL_DIR}` resolves from `model_dir` even when unexported."""
        cfg = self._registry_config(
            tmp_path,
            "mp_modeldir",
            '"${PREFILTER_MODEL_DIR}/detect/yolo11s.xml"',
            model_dir="/opt/models",
        )
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PREFILTER_MODEL_DIR", None)
            config = load_config(cfg)
        assert config.model_dir == "/opt/models"
        assert (
            config.prefilter_models["yolo11s"].model_path
            == "/opt/models/detect/yolo11s.xml"
        )

    def test_registry_legacy_model_dir_placeholder_expanded(self, tmp_path):
        """The pre-rename `${MODEL_DIR}` spelling keeps working."""
        cfg = self._registry_config(
            tmp_path,
            "mp_legacy",
            '"${MODEL_DIR}/detect/yolo11s.xml"',
            model_dir="/opt/models",
        )
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PREFILTER_MODEL_DIR", None)
            config = load_config(cfg)
        assert (
            config.prefilter_models["yolo11s"].model_path
            == "/opt/models/detect/yolo11s.xml"
        )

    def test_model_dir_env_override(self, tmp_path):
        cfg = self._registry_config(
            tmp_path, "mp_mdenv", '"${PREFILTER_MODEL_DIR}/yolo11s.xml"',
            model_dir="/opt/models",
        )
        with patch.dict(os.environ, {"PREFILTER_MODEL_DIR": "/srv/models"}, clear=False):
            config = load_config(cfg)
        assert config.model_dir == "/srv/models"
        assert config.prefilter_models["yolo11s"].model_path == "/srv/models/yolo11s.xml"

    def test_unresolved_model_dir_placeholder_falls_back(self, tmp_path):
        """A `${PREFILTER_MODEL_DIR}` value with nothing behind it must not
        become a literal placeholder root — it falls back to the default."""
        cfg = self._registry_config(
            tmp_path,
            "mp_fallback",
            '"${PREFILTER_MODEL_DIR}/detect/yolo11s.xml"',
            model_dir="${PREFILTER_MODEL_DIR}",
        )
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PREFILTER_MODEL_DIR", None)
            config = load_config(cfg)
        assert "$" not in config.model_dir
        assert config.model_dir == os.path.expanduser("~/models/openvino")
        assert config.prefilter_models["yolo11s"].model_path == os.path.expanduser(
            "~/models/openvino/detect/yolo11s.xml"
        )

    def test_model_dir_is_internal_and_defaults_from_env_or_builtin(self, tmp_path, monkeypatch):
        """The config file carries no model_dir; the root comes from the env var."""
        cfg_file = tmp_path / "no_model_dir.yaml"
        cfg_file.write_text("server:\n  port: 7777\n")
        monkeypatch.delenv("PREFILTER_MODEL_DIR", raising=False)
        assert load_config(str(cfg_file)).model_dir == os.path.expanduser("~/models/openvino")
        monkeypatch.setenv("PREFILTER_MODEL_DIR", "/srv/ov-models")
        assert load_config(str(cfg_file)).model_dir == "/srv/ov-models"

    def test_shipped_example_does_not_expose_model_dir(self):
        """A key users can see is a key users will edit — and it would not take
        effect under Docker, where the mount is fixed by the env var."""
        example = Path(__file__).resolve().parents[2] / "config" / "config.yaml.example"
        assert "model_dir" not in yaml.safe_load(example.read_text())

    def test_empty_registry_stays_empty(self, tmp_path):
        # No prefilter_models block must not blow up the expansion step.
        cfg_file = tmp_path / "mp_empty.yaml"
        cfg_file.write_text('model_dir: "/tmp/models"\ndefaults:\n  prefilter:\n    enabled: false\n')
        config = load_config(str(cfg_file))
        assert config.prefilter_models == {}
        assert config.defaults.prefilter.model == ""

    def test_registry_path_preserved_without_placeholders(self, tmp_path):
        # A plain absolute path passes through expansion untouched.
        cfg = self._registry_config(
            tmp_path, "mp_no_override", "/models/from_config.xml"
        )
        config = load_config(cfg)
        assert config.prefilter_models["yolo11s"].model_path == "/models/from_config.xml"

    def test_backend_is_case_insensitive(self, tmp_path):
        cfg_file = tmp_path / "mp_backend.yaml"
        cfg_file.write_text(
            'model_dir: "/tmp/models"\n'
            "prefilter_models:\n"
            "  m1:\n"
            "    kind: Detection\n"
            "    backend: OpenVINO\n"
            "    model_path: /models/m1.xml\n"
        )
        config = load_config(str(cfg_file))
        assert config.prefilter_models["m1"].backend == "openvino"
        assert config.prefilter_models["m1"].kind == "detection"


class TestConfigModels:
    def test_motion_config_defaults(self):
        cfg = MotionConfig()
        assert cfg.diff_threshold == 25
        assert cfg.area_ratio == 0.015
        assert cfg.stable_frames == 30

    def test_segment_config_defaults(self):
        cfg = SegmentConfig()
        assert cfg.max_duration == 10.0
        assert cfg.min_duration == 1.0

    def test_webhook_config_custom(self):
        cfg = WebhookConfig(url="http://example.com/events", timeout=30, retry_attempts=5)
        assert cfg.url == "http://example.com/events"
        assert cfg.timeout == 30
        assert cfg.retry_attempts == 5

    def test_source_config_requires_fields(self):
        src = SourceConfig(source_id="cam1", source_url="rtsp://localhost:8554/live/test")
        assert src.source_id == "cam1"
        assert src.source_url == "rtsp://localhost:8554/live/test"
        assert src.motion is None
        assert src.data_dir is None


class TestMergeConfig:
    def test_merge_config_none_uses_defaults(self):
        defaults = MotionConfig(diff_threshold=15, area_ratio=0.01, stable_frames=45)
        merged = merge_config(defaults, None)
        assert merged is defaults

    def test_merge_config_preserves_unset_fields(self):
        defaults = PrefilterConfig(
            enabled=True,
            model_path="/models/yolo11s.xml",
            target_classes=["person"],
            min_confidence=0.4,
            device="NPU",
        )
        override = PrefilterConfig(enabled=False)
        merged = merge_config(defaults, override)
        assert merged.enabled is False
        assert merged.model_path == "/models/yolo11s.xml"
        assert merged.target_classes == ["person"]
        assert merged.device == "NPU"


class TestClosedValueSets:
    """Fields the docs describe as enums must actually reject other values.

    Before this, `recovery_strategy` and `roi.mode` were bare `str`: the API
    accepted any string and the behaviour downstream was undefined.
    """

    @pytest.mark.parametrize("strategy", ["retry", "pause", "remove"])
    def test_recovery_strategy_accepts_documented_values(self, strategy):
        assert HealthConfig(recovery_strategy=strategy).recovery_strategy == strategy

    def test_recovery_strategy_rejects_unknown(self):
        with pytest.raises(ValidationError):
            HealthConfig(recovery_strategy="fuzzstring")

    @pytest.mark.parametrize("mode", ["crop", "highlight", "crop_and_concat"])
    def test_roi_mode_accepts_documented_values(self, mode):
        assert RoiConfig(mode=mode).mode == mode

    def test_roi_mode_rejects_unknown(self):
        with pytest.raises(ValidationError):
            RoiConfig(mode="fuzzstring")


class TestNumericBounds:
    @pytest.mark.parametrize(
        "kwargs",
        [
            {"diff_threshold": 0},
            {"diff_threshold": 256},
            {"area_ratio": -0.1},
            {"area_ratio": 1.5},
            {"stable_frames": 0},
        ],
    )
    def test_motion_bounds(self, kwargs):
        with pytest.raises(ValidationError):
            MotionConfig(**kwargs)

    @pytest.mark.parametrize(
        "kwargs",
        [
            {"min_confidence": -0.1},
            {"min_confidence": 1.1},
            {"min_frames_hit": 0},
            {"detect_fps": 0},
            {"long_side": -1},
        ],
    )
    def test_prefilter_bounds(self, kwargs):
        with pytest.raises(ValidationError):
            PrefilterConfig(**kwargs)

    @pytest.mark.parametrize(
        "kwargs", [{"interval_seconds": 0}, {"interval_seconds": 3601}, {"fps": 0}, {"fps": 121}]
    )
    def test_recording_bounds(self, kwargs):
        with pytest.raises(ValidationError):
            RecordingConfig(**kwargs)

    @pytest.mark.parametrize(
        "kwargs", [{"max_failures": 0}, {"backoff_base": 0.5}, {"backoff_max": 0}]
    )
    def test_health_bounds(self, kwargs):
        with pytest.raises(ValidationError):
            HealthConfig(**kwargs)

    def test_roi_auto_split_area_must_be_a_fraction(self):
        with pytest.raises(ValidationError):
            RoiConfig(auto_split_area=1.5)


class TestSegmentDurationOrdering:
    def test_both_supplied_and_inverted_is_rejected(self):
        with pytest.raises(ValidationError):
            SegmentConfig(min_duration=30.0, max_duration=10.0)

    def test_both_supplied_and_ordered_is_accepted(self):
        cfg = SegmentConfig(min_duration=3.0, max_duration=60.0)
        assert cfg.min_duration == 3.0

    def test_partial_update_is_not_compared_against_the_default(self):
        """A lone `min_duration` must not be judged against `max_duration`'s default.

        `PUT /sources/{id}/pipeline` merges with `exclude_unset` semantics, so
        `{"segment": {"min_duration": 30}}` builds this model with the default
        max_duration=10.0 while the effective max after merging may be 60.
        Comparing here would reject a legitimate request.
        """
        cfg = SegmentConfig(min_duration=30.0)
        assert cfg.min_duration == 30.0
        assert cfg.max_duration == 10.0  # placeholder, not yet merged

    def test_effective_check_catches_the_inverted_merge_result(self):
        defaults = SegmentConfig(min_duration=1.0, max_duration=10.0)
        merged = merge_config(defaults, SegmentConfig(min_duration=30.0))
        with pytest.raises(ValueError, match="effective segment.min_duration"):
            validate_effective_segment(merged)

    def test_effective_check_passes_for_a_valid_merge(self):
        defaults = SegmentConfig(min_duration=1.0, max_duration=60.0)
        merged = merge_config(defaults, SegmentConfig(min_duration=30.0))
        validate_effective_segment(merged)  # must not raise


class TestAllowedDataRoots:
    def test_defaults_to_empty(self):
        assert AppConfig(model_dir="/tmp/models").allowed_data_roots == []

    def test_expanded_on_load(self, tmp_path, monkeypatch):
        cfg_file = tmp_path / "config.yaml"
        cfg_file.write_text('model_dir: "/tmp/models"\nallowed_data_roots:\n  - "~/vsa-alt"\n')
        config = load_config(str(cfg_file))
        assert config.allowed_data_roots == [
            os.path.join(os.path.expanduser("~"), "vsa-alt")
        ]
