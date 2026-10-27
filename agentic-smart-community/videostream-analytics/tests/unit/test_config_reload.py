"""Tests for POST /config/reload — hot config swap without a restart.

The contract: a successful reload swaps the shared AppConfig in place so every
consumer (endpoint closures, app.state, SourceManager) sees the new registry at
once; a missing or invalid file is an error that keeps the running config,
never a silent fall back to built-in defaults (which would empty the registry).
"""

import os
import time
from unittest.mock import MagicMock, patch

import pytest
import yaml
from fastapi.testclient import TestClient

import service as service_module
from service import create_app
from shared.config import AppConfig, load_config
from source_worker import SourceManager
from shared.model_registry import ModelShapeInfo


def _shape_info():
    return ModelShapeInfo(
        class_names=["person"],
        labels_source="embedded",
        input_shape="[1,3,704,1280]",
        output_shape="[1,5,8400]",
        is_detection=True,
    )


def _stub_inspect():
    return patch(
        "stream_monitor.pipeline.prefilter_yolo.inspect_model",
        return_value=_shape_info(),
    )


def _ir_pair(directory, stem):
    directory.mkdir(parents=True, exist_ok=True)
    xml = directory / f"{stem}.xml"
    xml.write_text("<net/>")
    (directory / f"{stem}.bin").write_bytes(b"\x00" * 16)
    return xml


def _write_config(path, model_dir, models, webhook_url=None):
    doc = {
        "model_dir": str(model_dir),
        "prefilter_models": {
            name: {"kind": "detection", "model_path": str(mp)}
            for name, mp in models.items()
        },
    }
    if webhook_url:
        doc["webhook"] = {"url": webhook_url}
    path.write_text(yaml.safe_dump(doc))


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for var in (
        "PREFILTER_MODEL_DIR",
        "SMART_COMMUNITY_DATA_DIR",
        "WEBHOOK_URL",
        "VIDEOSTREAM_CONFIG",
    ):
        monkeypatch.delenv(var, raising=False)


@pytest.fixture
def workspace(tmp_path):
    model_dir = tmp_path / "models"
    cfg = tmp_path / "config.yaml"
    _write_config(cfg, model_dir, {"yolo11s": _ir_pair(model_dir, "yolo11s")})
    return tmp_path, model_dir, cfg


@pytest.fixture
def mock_manager():
    mgr = MagicMock(spec=SourceManager)
    mgr._bundles = {}
    return mgr


def _make_client(app, mock_manager, monkeypatch):
    tc = TestClient(app, raise_server_exceptions=False)
    tc.__enter__()
    # Patch AFTER the lifespan has bound a real SourceManager (see
    # test_app_endpoints for why the order matters).
    monkeypatch.setattr(service_module, "_manager", mock_manager)
    return tc


class TestConfigReload:
    def test_reload_picks_up_new_registry_entry(
        self, workspace, mock_manager, monkeypatch
    ):
        _, model_dir, cfg = workspace
        app = create_app(load_config(str(cfg)), config_path=str(cfg))
        with _stub_inspect():
            tc = _make_client(app, mock_manager, monkeypatch)
            try:
                assert [m["name"] for m in tc.get("/capabilities/prefilter").json()["models"]] == ["yolo11s"]

                _write_config(
                    cfg,
                    model_dir,
                    {
                        "yolo11s": model_dir / "yolo11s.xml",
                        "helmet_v2": _ir_pair(model_dir / "helmet", "helmet_v2"),
                    },
                )
                resp = tc.post("/config/reload")
                assert resp.status_code == 200
                body = resp.json()
                assert body["status"] == "reloaded"
                assert sorted(body["models"]) == ["helmet_v2", "yolo11s"]

                names = [m["name"] for m in tc.get("/capabilities/prefilter").json()["models"]]
                assert sorted(names) == ["helmet_v2", "yolo11s"]
                mock_manager.on_config_reloaded.assert_called_once()
            finally:
                tc.__exit__(None, None, None)

    def test_default_model_path_is_resolved_before_the_swap_is_visible(
        self, workspace, mock_manager, monkeypatch
    ):
        """No window where the live config carries an empty default model_path.

        A source registered with no `prefilter` block inherits the default
        wholesale; an empty path there silently disables its prefilter for good.
        Watch the LIVE config at the moment the default is resolved: if the swap
        has already happened by then, the live path is the new config's empty one.
        """
        _, model_dir, cfg = workspace
        doc = yaml.safe_load(cfg.read_text())
        doc["defaults"] = {"prefilter": {"enabled": True, "model": "yolo11s"}}
        cfg.write_text(yaml.safe_dump(doc))

        app = create_app(load_config(str(cfg)), config_path=str(cfg))
        real_resolve = service_module.resolve_default_prefilter_model
        live_paths = []

        def spy(config):
            live_paths.append(app.state.config.defaults.prefilter.model_path)
            return real_resolve(config)

        with _stub_inspect():
            tc = _make_client(app, mock_manager, monkeypatch)
            try:
                # Startup resolved the default; only calls from the reload count.
                assert app.state.config.defaults.prefilter.model_path
                monkeypatch.setattr(service_module, "resolve_default_prefilter_model", spy)
                assert tc.post("/config/reload").status_code == 200
            finally:
                tc.__exit__(None, None, None)

        assert live_paths and all(live_paths), live_paths
        assert app.state.config.defaults.prefilter.model_path == str(model_dir / "yolo11s.xml")

    def test_reload_invalid_yaml_keeps_running_config(
        self, workspace, mock_manager, monkeypatch
    ):
        _, _, cfg = workspace
        app = create_app(load_config(str(cfg)), config_path=str(cfg))
        with _stub_inspect():
            tc = _make_client(app, mock_manager, monkeypatch)
            try:
                cfg.write_text(":\n- [not yaml")
                resp = tc.post("/config/reload")
                assert resp.status_code == 422
                assert resp.json()["detail"]["error"] == "config_invalid"

                names = [m["name"] for m in tc.get("/capabilities/prefilter").json()["models"]]
                assert names == ["yolo11s"]
                mock_manager.on_config_reloaded.assert_not_called()
            finally:
                tc.__exit__(None, None, None)

    def test_reload_missing_file_keeps_running_config(
        self, workspace, mock_manager, monkeypatch
    ):
        _, _, cfg = workspace
        app = create_app(load_config(str(cfg)), config_path=str(cfg))
        with _stub_inspect():
            tc = _make_client(app, mock_manager, monkeypatch)
            try:
                os.remove(cfg)
                resp = tc.post("/config/reload")
                assert resp.status_code == 400
                assert resp.json()["detail"]["error"] == "config_not_found"

                names = [m["name"] for m in tc.get("/capabilities/prefilter").json()["models"]]
                assert names == ["yolo11s"]
                mock_manager.on_config_reloaded.assert_not_called()
            finally:
                tc.__exit__(None, None, None)

    def test_reload_non_mapping_yaml_keeps_running_config(
        self, workspace, mock_manager, monkeypatch
    ):
        # Valid YAML that is not a mapping (a bare scalar here) must be a
        # config_invalid 422, not a TypeError-turned-500.
        _, _, cfg = workspace
        app = create_app(load_config(str(cfg)), config_path=str(cfg))
        with _stub_inspect():
            tc = _make_client(app, mock_manager, monkeypatch)
            try:
                cfg.write_text("just a string\n")
                resp = tc.post("/config/reload")
                assert resp.status_code == 422
                assert resp.json()["detail"]["error"] == "config_invalid"

                names = [m["name"] for m in tc.get("/capabilities/prefilter").json()["models"]]
                assert names == ["yolo11s"]
                mock_manager.on_config_reloaded.assert_not_called()
            finally:
                tc.__exit__(None, None, None)

    def test_reload_prefers_reload_path(self, workspace, mock_manager, monkeypatch, tmp_path):
        _, model_dir, cfg_old = workspace
        cfg_new = tmp_path / "live" / "config.yaml"
        cfg_new.parent.mkdir()
        _write_config(
            cfg_new, model_dir, {"helmet_v2": _ir_pair(model_dir / "helmet", "helmet_v2")}
        )
        app = create_app(
            load_config(str(cfg_old)),
            config_path=str(cfg_old),
            reload_path=str(cfg_new),
        )
        with _stub_inspect():
            tc = _make_client(app, mock_manager, monkeypatch)
            try:
                resp = tc.post("/config/reload")
                assert resp.status_code == 200
                assert resp.json()["path"] == str(cfg_new)
                assert resp.json()["models"] == ["helmet_v2"]
            finally:
                tc.__exit__(None, None, None)

    def test_reload_without_any_path_is_400(self, mock_manager, monkeypatch):
        app = create_app(AppConfig(model_dir="/tmp/models"))
        tc = _make_client(app, mock_manager, monkeypatch)
        try:
            resp = tc.post("/config/reload")
            assert resp.status_code == 400
            assert resp.json()["detail"]["error"] == "config_not_found"
        finally:
            tc.__exit__(None, None, None)

    def test_dangling_reload_path_falls_back_to_config_path(
        self, workspace, mock_manager, monkeypatch
    ):
        # Bare-compose shape: --reload-config points into a directory mount
        # that holds no config.yaml — reload must read --config, not 400.
        _, _, cfg = workspace
        app = create_app(
            load_config(str(cfg)),
            config_path=str(cfg),
            reload_path="/nonexistent-dir/config.yaml",
        )
        with _stub_inspect():
            tc = _make_client(app, mock_manager, monkeypatch)
            try:
                resp = tc.post("/config/reload")
                assert resp.status_code == 200
                assert resp.json()["path"] == str(cfg)
                assert resp.json()["models"] == ["yolo11s"]
            finally:
                tc.__exit__(None, None, None)


class TestConfigWatch:
    def test_file_change_auto_reloads(self, workspace, mock_manager, monkeypatch):
        _, model_dir, cfg = workspace
        monkeypatch.setattr(service_module, "_CONFIG_WATCH_INTERVAL_S", 0.05)
        monkeypatch.setattr(service_module, "_CONFIG_WATCH_DEBOUNCE_S", 0.01)
        app = create_app(load_config(str(cfg)), config_path=str(cfg))
        with _stub_inspect():
            tc = _make_client(app, mock_manager, monkeypatch)
            try:
                time.sleep(0.15)  # let the watcher take its startup baseline
                _write_config(
                    cfg,
                    model_dir,
                    {
                        "yolo11s": model_dir / "yolo11s.xml",
                        "helmet_v2": _ir_pair(model_dir / "helmet", "helmet_v2"),
                    },
                )
                deadline = time.time() + 5
                names = []
                while time.time() < deadline:
                    names = [m["name"] for m in tc.get("/capabilities/prefilter").json()["models"]]
                    if "helmet_v2" in names:
                        break
                    time.sleep(0.05)
                assert sorted(names) == ["helmet_v2", "yolo11s"]
            finally:
                tc.__exit__(None, None, None)

    def test_broken_edit_keeps_running_config_and_recovers(
        self, workspace, mock_manager, monkeypatch, caplog
    ):
        _, model_dir, cfg = workspace
        monkeypatch.setattr(service_module, "_CONFIG_WATCH_INTERVAL_S", 0.05)
        monkeypatch.setattr(service_module, "_CONFIG_WATCH_DEBOUNCE_S", 0.01)
        app = create_app(load_config(str(cfg)), config_path=str(cfg))
        with _stub_inspect():
            tc = _make_client(app, mock_manager, monkeypatch)
            try:
                time.sleep(0.15)  # let the watcher take its startup baseline
                cfg.write_text("just a string\n")
                deadline = time.time() + 5
                while time.time() < deadline:
                    if any("auto-reload failed" in r.message for r in caplog.records):
                        break
                    time.sleep(0.05)
                assert any("auto-reload failed" in r.message for r in caplog.records)
                names = [m["name"] for m in tc.get("/capabilities/prefilter").json()["models"]]
                assert names == ["yolo11s"]

                _write_config(
                    cfg, model_dir, {"yolo11s": model_dir / "yolo11s.xml",
                                     "m2": _ir_pair(model_dir / "m2", "m2")}
                )
                deadline = time.time() + 5
                names = []
                while time.time() < deadline:
                    names = [m["name"] for m in tc.get("/capabilities/prefilter").json()["models"]]
                    if "m2" in names:
                        break
                    time.sleep(0.05)
                assert "m2" in names
            finally:
                tc.__exit__(None, None, None)


class TestOnConfigReloaded:
    def test_default_sink_rebuilt_with_new_webhook_url(self):
        config = AppConfig(model_dir="/tmp/models")
        config.webhook.url = "http://old:3101/events"
        mgr = SourceManager(config)
        config.webhook.url = "http://new:3101/events"
        mgr.on_config_reloaded()
        assert mgr._default_sink.url == "http://new:3101/events"
