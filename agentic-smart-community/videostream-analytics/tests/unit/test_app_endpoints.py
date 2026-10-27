"""Tests for FastAPI endpoints with mocked SourceManager.

The request schemas in service.py use the nested `pipeline` wrapper and
reject the old flat format with HTTP 422.
"""

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

import service as service_module
from service import create_app
from shared.config import AppConfig
from source_worker import SourceManager


@pytest.fixture
def mock_manager():
    mgr = MagicMock(spec=SourceManager)
    mgr.get_sources.return_value = []
    mgr.get_source_status.return_value = None
    # `update_pipeline` asks which model the source already runs so a partial
    # update does not reset it to the deployment default. Default to "unknown",
    # the same answer the real manager gives for a source it has never seen.
    mgr.get_source_prefilter_model.return_value = ""
    mgr._bundles = {}
    return mgr


@pytest.fixture
def app_and_client(mock_manager, monkeypatch):
    """Spin up the real service.create_app() against a mocked SourceManager.

    Must patch `_manager` AFTER TestClient enters context — the lifespan
    handler creates a real SourceManager on startup. Patching before would
    be overwritten.
    """
    app = create_app(AppConfig(model_dir="/tmp/models"))
    with TestClient(app, raise_server_exceptions=False) as tc:
        monkeypatch.setattr(service_module, "_manager", mock_manager)
        yield tc, mock_manager


@pytest.fixture
def client(app_and_client):
    return app_and_client[0]


@pytest.fixture
def mock_mgr(app_and_client):
    return app_and_client[1]


# Lifespan startup re-binds _manager. Re-patch in each test that needs it,
# or use the fixture above which patches AFTER `with TestClient(...)` enters.


class TestHealthEndpoint:
    def test_health_returns_200(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["service"] == "videostream-analytics"


class TestListSources:
    def test_empty_sources(self, client, mock_mgr):
        mock_mgr.get_sources.return_value = []
        resp = client.get("/sources")
        assert resp.status_code == 200
        # /sources returns a bare array, not {"sources": [...]}
        assert resp.json() == []

    def test_with_sources(self, client, mock_mgr):
        mock_mgr.get_sources.return_value = [
            {
                "source_id": "cam1",
                "source_url": "rtsp://localhost:8554/live/cam1",
                "status": "online",
                "running": True,
            }
        ]
        resp = client.get("/sources")
        assert resp.status_code == 200
        sources = resp.json()
        assert isinstance(sources, list)
        assert len(sources) == 1
        assert sources[0]["source_id"] == "cam1"


class TestGetSource:
    def test_existing_source(self, client, mock_mgr):
        mock_mgr.get_source_status.return_value = {
            "source_id": "cam1",
            "source_url": "rtsp://localhost:8554/live/cam1",
            "status": "online",
            "running": True,
        }
        resp = client.get("/sources/cam1")
        assert resp.status_code == 200
        assert resp.json()["source_id"] == "cam1"

    def test_status_endpoint_alias(self, client, mock_mgr):
        """MCP's analyticsSourceExists hits /sources/{id}/status."""
        mock_mgr.get_source_status.return_value = {
            "source_id": "cam1",
            "status": "online",
        }
        resp = client.get("/sources/cam1/status")
        assert resp.status_code == 200
        assert resp.json()["source_id"] == "cam1"

    def test_nonexistent_source(self, client, mock_mgr):
        mock_mgr.get_source_status.return_value = None
        resp = client.get("/sources/nonexistent")
        assert resp.status_code == 404

    def test_nonexistent_status_returns_404(self, client, mock_mgr):
        mock_mgr.get_source_status.return_value = None
        resp = client.get("/sources/nonexistent/status")
        assert resp.status_code == 404


class TestGetSourcePipeline:
    def test_pipeline_returns_effective_config(self, client, mock_mgr):
        mock_mgr.get_source_pipeline.return_value = {
            "source_id": "cam1",
            "pipeline": {
                "prefilter": {
                    "enabled": True,
                    "model": "yolo11s",
                    "target_classes": ["person"],
                },
            },
        }
        resp = client.get("/sources/cam1/pipeline")
        assert resp.status_code == 200
        data = resp.json()
        assert data["source_id"] == "cam1"
        assert data["pipeline"]["prefilter"]["model"] == "yolo11s"
        # The resolved server path never leaves the process.
        assert "model_path" not in data["pipeline"]["prefilter"]

    def test_pipeline_nonexistent_source_returns_404(self, client, mock_mgr):
        mock_mgr.get_source_pipeline.return_value = None
        resp = client.get("/sources/nonexistent/pipeline")
        assert resp.status_code == 404


class TestRegisterSource:
    def test_register_success_nested(self, client, mock_mgr):
        mock_mgr.register_source.return_value = {
            "status": "started",
            "source_id": "cam1",
            "source_url": "rtsp://localhost:8554/live/cam1",
        }
        resp = client.post("/register_source", json={
            "source_id": "cam1",
            "source_url": "rtsp://localhost:8554/live/cam1",
            "data_dir": "/tmp/cam1",
            "pipeline": {
                "prefilter": {"enabled": False},
            },
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "started"

    def test_register_accepts_roi_block(self, client, mock_mgr):
        """pipeline.roi top-level block must be accepted.

        No `model` here on purpose: this test is about the `roi` block, so the
        prefilter inherits the deployment default, which is what MCP does.
        """
        mock_mgr.register_source.return_value = {
            "status": "started",
            "source_id": "cam_child",
            "source_url": "rtsp://localhost:8554/live/child",
        }
        resp = client.post("/register_source", json={
            "source_id": "cam_child",
            "source_url": "rtsp://localhost:8554/live/child",
            "pipeline": {
                "prefilter": {
                    "enabled": True,
                    "target_classes": ["person"],
                },
                "roi": {
                    "enabled": True,
                    "mode": "crop",
                    "expand": 0.25,
                    "auto_split_area": 0.35,
                },
            },
        })
        assert resp.status_code == 200
        # Verify the roi block survived into the SourceConfig hand-off.
        ((source_arg,), _) = mock_mgr.register_source.call_args
        assert source_arg.roi is not None
        assert source_arg.roi.enabled is True
        assert source_arg.roi.mode == "crop"
        assert source_arg.roi.auto_split_area == 0.35

    def test_register_already_running(self, client, mock_mgr):
        mock_mgr.register_source.return_value = {
            "status": "already_running",
            "source_id": "cam1",
        }
        resp = client.post("/register_source", json={
            "source_id": "cam1",
            "source_url": "rtsp://localhost:8554/live/cam1",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "already_running"

    def test_register_rejects_old_flat_body(self, client, mock_mgr):
        """Old rtsp_url / top-level motion must 422."""
        resp = client.post("/register_source", json={
            "source_id": "cam1",
            "rtsp_url": "rtsp://localhost:8554/live/cam1",
            "use_case": "child_safety",
            "motion": {"diff_threshold": 15},
        })
        assert resp.status_code == 422
        body = resp.json()
        assert "unknown_fields" in body
        # rtsp_url, use_case, motion must each appear in unknown_fields
        assert "rtsp_url" in body["unknown_fields"]
        assert "use_case" in body["unknown_fields"]
        assert "motion" in body["unknown_fields"]

    def test_register_missing_source_url_returns_422(self, client, mock_mgr):
        resp = client.post("/register_source", json={"source_id": "cam1"})
        assert resp.status_code == 422


class TestUnregisterSource:
    def test_unregister_success(self, client, mock_mgr):
        mock_mgr.unregister_source.return_value = {
            "status": "stopped",
            "source_id": "cam1",
        }
        resp = client.delete("/sources/cam1")
        assert resp.status_code == 200
        assert resp.json()["status"] == "stopped"

    def test_unregister_not_found(self, client, mock_mgr):
        mock_mgr.unregister_source.return_value = {
            "status": "not_found",
            "source_id": "nonexistent",
        }
        resp = client.delete("/sources/nonexistent")
        assert resp.status_code == 404


class TestStopSource:
    def test_stop_success(self, client, mock_mgr):
        mock_mgr.unregister_source.return_value = {
            "status": "stopped",
            "source_id": "cam1",
        }
        resp = client.post("/sources/cam1/stop")
        assert resp.status_code == 200

    def test_stop_not_found(self, client, mock_mgr):
        mock_mgr.unregister_source.return_value = {
            "status": "not_found",
            "source_id": "cam1",
        }
        resp = client.post("/sources/cam1/stop")
        assert resp.status_code == 404


class TestRestartSource:
    """Restart is delegated to `SourceManager.restart_source`.

    The endpoint used to reach into `mgr._bundles` and drive stop/start itself,
    which meant it ran outside the per-source lock and could interleave with an
    unregister. The stop/start sequencing is covered by
    `test_source_manager.py`; here we only assert the delegation.
    """

    def test_restart_success(self, client, mock_mgr):
        mock_mgr.restart_source.return_value = {
            "status": "restarted",
            "source_id": "cam1",
        }
        resp = client.post("/sources/cam1/restart")
        assert resp.status_code == 200
        assert resp.json()["status"] == "restarted"
        mock_mgr.restart_source.assert_called_once_with("cam1")

    def test_restart_not_found(self, client, mock_mgr):
        mock_mgr.restart_source.return_value = {
            "status": "not_found",
            "source_id": "nonexistent",
        }
        resp = client.post("/sources/nonexistent/restart")
        assert resp.status_code == 404


class TestPauseSource:
    def test_pause_success(self, client, mock_mgr):
        mock_mgr.pause_source.return_value = {
            "status": "paused",
            "source_id": "cam1",
        }
        resp = client.post("/sources/cam1/pause")
        assert resp.status_code == 200
        assert resp.json()["status"] == "paused"

    def test_pause_not_found(self, client, mock_mgr):
        mock_mgr.pause_source.return_value = {
            "status": "not_found",
            "source_id": "cam1",
        }
        resp = client.post("/sources/cam1/pause")
        assert resp.status_code == 404


class TestResumeSource:
    def test_resume_success(self, client, mock_mgr):
        mock_mgr.resume_source.return_value = {
            "status": "online",
            "source_id": "cam1",
        }
        resp = client.post("/sources/cam1/resume")
        assert resp.status_code == 200
        assert resp.json()["status"] == "online"

    def test_resume_not_found(self, client, mock_mgr):
        mock_mgr.resume_source.return_value = {
            "status": "not_found",
            "source_id": "cam1",
        }
        resp = client.post("/sources/cam1/resume")
        assert resp.status_code == 404


def register_model(
    client,
    tmp_path,
    name="m1",
    class_names=("person", "knife"),
    labels_source="embedded",
    **entry_fields,
):
    """Put a usable model in the registry and return its name.

    `app.state.config` IS the object `create_app` closed over, so mutating it
    here is what the endpoints see. The IR pair is faked on disk and
    `inspect_model` is stubbed, since the real thing needs OpenVINO and a
    genuine model file.
    """
    from unittest.mock import patch

    from shared.config import PrefilterModelConfig
    from shared.model_registry import ModelShapeInfo

    model = tmp_path / f"{name}.xml"
    model.write_text("<net/>")
    (tmp_path / f"{name}.bin").write_bytes(b"\x00")

    config = client.app.state.config
    config.model_dir = str(tmp_path.parent)
    config.prefilter_models[name] = PrefilterModelConfig(
        kind=entry_fields.pop("kind", "detection"),
        model_path=str(model),
        **entry_fields,
    )
    info = ModelShapeInfo(
        class_names=list(class_names),
        labels_source=labels_source,
        input_shape="[1,3,640,640]",
        output_shape=f"[1,{4 + len(class_names)},8400]",
        is_detection=True,
    )
    return name, patch(
        "stream_monitor.pipeline.prefilter_yolo.inspect_model", return_value=info
    )


class TestPrefilterCapabilities:
    def test_capabilities_empty_registry(self, client):
        """Default AppConfig registers no models → nothing selectable."""
        resp = client.get("/capabilities/prefilter")
        assert resp.status_code == 200
        data = resp.json()
        assert data["models"] == []
        assert data["rejected"] == []
        assert data["default_model"] == ""
        assert data["supported_kinds"] == ["detection"]
        assert data["supported_backends"] == ["openvino"]
        assert data["available_devices"]  # non-empty (at least ["CPU"])
        assert data["defaults"]["min_confidence"] == 0.4

    def test_capabilities_lists_registered_model(self, client, tmp_path):
        name, stub = register_model(client, tmp_path)
        client.app.state.config.defaults.prefilter.model = name
        with stub:
            resp = client.get("/capabilities/prefilter")
        assert resp.status_code == 200
        data = resp.json()
        assert [m["name"] for m in data["models"]] == [name]
        assert data["models"][0]["backend"] == "openvino"
        assert data["models"][0]["class_names"] == ["person", "knife"]
        assert data["default_model"] == name

    def test_capabilities_reports_rejection_reason(self, client, tmp_path):
        """A registered entry that cannot be used is diagnosable, not selectable."""
        from shared.config import PrefilterModelConfig

        config = client.app.state.config
        config.model_dir = str(tmp_path)
        config.prefilter_models["ghost"] = PrefilterModelConfig(
            kind="detection", model_path=str(tmp_path / "missing.xml")
        )
        resp = client.get("/capabilities/prefilter")
        assert resp.status_code == 200
        data = resp.json()
        assert data["models"] == []
        assert data["rejected"][0]["name"] == "ghost"
        assert "missing.xml" in data["rejected"][0]["reason"]

    def test_capabilities_single_model_query(self, client, tmp_path):
        name, stub = register_model(client, tmp_path)
        with stub:
            resp = client.get(f"/capabilities/prefilter?model={name}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == name
        assert data["class_names"] == ["person", "knife"]

    def test_capabilities_single_model_query_unknown(self, client):
        resp = client.get("/capabilities/prefilter?model=nope")
        assert resp.status_code == 404
        assert resp.json()["detail"]["error"] == "model_not_available"


class TestPrefilterModelSelection:
    def test_register_rejects_request_model_path(self, client, mock_mgr):
        """Models come from the registry; a raw path in a request is refused."""
        resp = client.post("/register_source", json={
            "source_id": "cam1",
            "source_url": "rtsp://localhost:8554/live/cam1",
            "pipeline": {
                "prefilter": {"enabled": True, "model_path": "/etc/passwd"},
            },
        })
        assert resp.status_code == 422
        assert resp.json()["detail"]["error"] == "model_path is not accepted"
        mock_mgr.register_source.assert_not_called()

    def test_register_rejects_unregistered_model(self, client, mock_mgr):
        resp = client.post("/register_source", json={
            "source_id": "cam1",
            "source_url": "rtsp://localhost:8554/live/cam1",
            "pipeline": {"prefilter": {"enabled": True, "model": "nope"}},
        })
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert detail["error"] == "model_not_available"
        assert detail["model"] == "nope"
        mock_mgr.register_source.assert_not_called()

    def test_register_resolves_model_to_path(self, client, mock_mgr, tmp_path):
        """The registry entry's path is what reaches the pipeline."""
        name, stub = register_model(client, tmp_path)
        mock_mgr.register_source.return_value = {"status": "started", "source_id": "cam1"}
        with stub:
            resp = client.post("/register_source", json={
                "source_id": "cam1",
                "source_url": "rtsp://localhost:8554/live/cam1",
                "pipeline": {"prefilter": {"enabled": True, "model": name}},
            })
        assert resp.status_code == 200
        ((source_arg,), _) = mock_mgr.register_source.call_args
        assert source_arg.prefilter.model == name
        assert source_arg.prefilter.model_path == str(tmp_path / f"{name}.xml")


class TestTargetClassesValidation:
    def test_register_rejects_unknown_target_class(self, client, mock_mgr, tmp_path):
        name, stub = register_model(client, tmp_path)
        with stub:
            resp = client.post("/register_source", json={
                "source_id": "cam1",
                "source_url": "rtsp://localhost:8554/live/cam1",
                "pipeline": {
                    "prefilter": {
                        "enabled": True,
                        "model": name,
                        "target_classes": ["person", "helmets"],
                    },
                },
            })
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert detail["error"] == "unknown target_classes"
        assert detail["unknown"] == ["helmets"]
        assert "knife" in detail["class_names"]

    def test_register_accepts_valid_target_class(self, client, mock_mgr, tmp_path):
        name, stub = register_model(client, tmp_path)
        mock_mgr.register_source.return_value = {"status": "started", "source_id": "cam1"}
        with stub:
            resp = client.post("/register_source", json={
                "source_id": "cam1",
                "source_url": "rtsp://localhost:8554/live/cam1",
                "pipeline": {
                    "prefilter": {
                        "enabled": True,
                        "model": name,
                        "target_classes": ["person", "knife"],
                    },
                },
            })
        assert resp.status_code == 200

    def test_register_skips_validation_when_labels_untrusted(self, client, mock_mgr, tmp_path):
        """A fallback_coco/unavailable label set is a guess — don't hard-fail."""
        name, stub = register_model(
            client, tmp_path, class_names=("person",), labels_source="fallback_coco"
        )
        mock_mgr.register_source.return_value = {"status": "started", "source_id": "cam1"}
        with stub:
            resp = client.post("/register_source", json={
                "source_id": "cam1",
                "source_url": "rtsp://localhost:8554/live/cam1",
                "pipeline": {
                    "prefilter": {
                        "enabled": True,
                        "model": name,
                        "target_classes": ["anything_goes"],
                    },
                },
            })
        assert resp.status_code == 200


class TestSourceIdValidation:
    """`source_id` reaches the filesystem as `<data_dir>/<source_id>`.

    Same regex as the dashboard's `monitorIdSchema`
    (packages/mcp-server/src/dashboard/router.ts), so an id MCP accepts is an
    id VSA accepts.
    """

    @pytest.mark.parametrize("source_id", ["cam_ok\n", "cam_ok\r", "cam_ok\t"])
    def test_trailing_whitespace_is_not_a_bypass(self, client, mock_mgr, source_id):
        """`$` must not match before a trailing newline.

        Python's `re` treats `^...$` as newline-lax, so `"cam_ok\\n"` would slip
        through and become a directory name. pydantic v2's default rust-regex
        engine anchors strictly; this test fails loudly if that ever changes
        (e.g. someone sets `regex_engine="python-re"`).
        """
        resp = client.post(
            "/register_source",
            json={"source_id": source_id, "source_url": "rtsp://localhost:8554/live/x"},
        )
        assert resp.status_code == 422
        mock_mgr.register_source.assert_not_called()

    @pytest.mark.parametrize(
        "source_id",
        ["../../tmp/pwn", "..", "a/b", "cam child", "cam.child", "", "x" * 129],
    )
    def test_register_rejects_invalid_source_id(self, client, mock_mgr, source_id):
        resp = client.post(
            "/register_source",
            json={"source_id": source_id, "source_url": "rtsp://localhost:8554/live/x"},
        )
        assert resp.status_code == 422
        mock_mgr.register_source.assert_not_called()

    @pytest.mark.parametrize("source_id", ["cam_child", "cam-1", "CAM1", "x" * 128])
    def test_register_accepts_valid_source_id(self, client, mock_mgr, source_id):
        mock_mgr.register_source.return_value = {"status": "started", "source_id": source_id}
        resp = client.post(
            "/register_source",
            json={"source_id": source_id, "source_url": "rtsp://localhost:8554/live/x"},
        )
        assert resp.status_code == 200

    def test_path_param_traversal_is_rejected(self, client, mock_mgr):
        resp = client.get("/sources/..%2F..%2Fetc")
        assert resp.status_code in (404, 422)
        mock_mgr.get_source_status.assert_not_called()

    def test_delete_with_invalid_id_is_rejected(self, client, mock_mgr):
        resp = client.delete("/sources/cam%20child")
        assert resp.status_code == 422
        mock_mgr.unregister_source.assert_not_called()


class TestRequestFieldValidation:
    def test_relative_data_dir_is_rejected(self, client, mock_mgr):
        """The reported §1.1 repro: `data_dir: "fuzzstring"` used to 500."""
        resp = client.post(
            "/register_source",
            json={
                "source_id": "fuzz-repro",
                "source_url": "rtsp://localhost:8554/live/x",
                "data_dir": "fuzzstring",
            },
        )
        assert resp.status_code == 422
        mock_mgr.register_source.assert_not_called()

    def test_empty_source_url_is_rejected(self, client, mock_mgr):
        resp = client.post(
            "/register_source", json={"source_id": "cam1", "source_url": ""}
        )
        assert resp.status_code == 422

    @pytest.mark.parametrize(
        "webhook_url",
        ["ftp://host/x", "file:///etc/passwd", "not-a-url", "http://u:p@host/x", "http://"],
    )
    def test_bad_webhook_url_is_rejected(self, client, mock_mgr, webhook_url):
        resp = client.post(
            "/register_source",
            json={
                "source_id": "cam1",
                "source_url": "rtsp://localhost:8554/live/x",
                "webhook_url": webhook_url,
            },
        )
        assert resp.status_code == 422
        mock_mgr.register_source.assert_not_called()

    def test_good_webhook_url_is_accepted(self, client, mock_mgr):
        mock_mgr.register_source.return_value = {"status": "started", "source_id": "cam1"}
        resp = client.post(
            "/register_source",
            json={
                "source_id": "cam1",
                "source_url": "rtsp://localhost:8554/live/x",
                "webhook_url": "http://localhost:3101/events",
            },
        )
        assert resp.status_code == 200

    def test_control_characters_are_rejected(self, client, mock_mgr):
        resp = client.post(
            "/register_source",
            json={"source_id": "cam1", "source_url": "rtsp://host/\x00x"},
        )
        assert resp.status_code == 422

    def test_out_of_range_pipeline_value_is_rejected(self, client, mock_mgr):
        resp = client.post(
            "/register_source",
            json={
                "source_id": "cam1",
                "source_url": "rtsp://localhost:8554/live/x",
                "pipeline": {"motion": {"area_ratio": 5.0}},
            },
        )
        assert resp.status_code == 422

    def test_unknown_recovery_strategy_is_rejected(self, client, mock_mgr):
        resp = client.post(
            "/register_source",
            json={
                "source_id": "cam1",
                "source_url": "rtsp://localhost:8554/live/x",
                "pipeline": {"health": {"recovery_strategy": "fuzzstring"}},
            },
        )
        assert resp.status_code == 422


class TestErrorMapping:
    """Business-layer failures must map to a deliberate status, never a bare 500."""

    def test_oserror_becomes_400(self, client, mock_mgr):
        mock_mgr.register_source.side_effect = PermissionError(
            13, "Permission denied", "/home/someone/secret/segments"
        )
        resp = client.post(
            "/register_source",
            json={"source_id": "cam1", "source_url": "rtsp://localhost:8554/live/x"},
        )
        assert resp.status_code == 400

    def test_400_body_does_not_leak_server_paths(self, client, mock_mgr):
        mock_mgr.register_source.side_effect = PermissionError(
            13, "Permission denied", "/home/someone/secret/segments"
        )
        resp = client.post(
            "/register_source",
            json={"source_id": "cam1", "source_url": "rtsp://localhost:8554/live/x"},
        )
        assert "/home/someone/secret" not in resp.text
        assert resp.json()["detail"]["reason"] == "PermissionError"

    def test_value_error_becomes_400(self, client, mock_mgr):
        mock_mgr.register_source.side_effect = ValueError(
            "path escapes the permitted data root(s)"
        )
        resp = client.post(
            "/register_source",
            json={"source_id": "cam1", "source_url": "rtsp://localhost:8554/live/x"},
        )
        assert resp.status_code == 400

    def test_connection_error_becomes_503(self, client, mock_mgr):
        """ffmpeg missing from PATH is a server defect, not a bad request."""
        mock_mgr.register_source.side_effect = ConnectionError(
            "ffmpeg not found on PATH; cannot record (copy backend)"
        )
        resp = client.post(
            "/register_source",
            json={"source_id": "cam1", "source_url": "rtsp://localhost:8554/live/x"},
        )
        assert resp.status_code == 503
        assert resp.json()["detail"]["error"] == "dependency_unavailable"

    def test_delete_maps_oserror_to_400(self, client, mock_mgr):
        mock_mgr.unregister_source.side_effect = OSError("boom")
        resp = client.delete("/sources/cam1")
        assert resp.status_code == 400

    def test_update_pipeline_maps_value_error_to_400(self, client, mock_mgr):
        mock_mgr.update_pipeline_config.side_effect = ValueError(
            "effective segment.min_duration (30.0) must not exceed"
        )
        resp = client.put(
            "/sources/cam1/pipeline", json={"pipeline": {"segment": {"min_duration": 30}}}
        )
        assert resp.status_code == 400

    def test_partial_segment_update_is_not_rejected_by_schema(self, client, mock_mgr):
        """A lone `min_duration` must reach the manager, not 422 at the schema."""
        mock_mgr.update_pipeline_config.return_value = {
            "status": "updated",
            "source_id": "cam1",
        }
        resp = client.put(
            "/sources/cam1/pipeline", json={"pipeline": {"segment": {"min_duration": 30}}}
        )
        assert resp.status_code == 200
        mock_mgr.update_pipeline_config.assert_called_once()


class TestSourceUrlSchemeAllowlist:
    """`source_url` reaches `ffmpeg -i` and cv2.VideoCapture verbatim.

    ffmpeg speaks `file:`, `concat:`, `subfile:`, `data:` … so an unrestricted
    scheme is an arbitrary-file-read whose output lands in `data_dir`, which the
    MCP dashboard serves back as mp4.
    """

    @pytest.mark.parametrize(
        "source_url",
        [
            "file:///etc/shadow",
            "concat:/etc/passwd|/etc/shadow",
            "subfile,,start,0,end,100,,:/etc/passwd",
            "data:text/plain;base64,AAAA",
            "ftp://host/x",
            "/etc/passwd",
            "relative/path.mp4",
        ],
    )
    def test_disallowed_scheme_is_rejected(self, client, mock_mgr, source_url):
        resp = client.post(
            "/register_source", json={"source_id": "cam1", "source_url": source_url}
        )
        assert resp.status_code == 400, source_url
        mock_mgr.register_source.assert_not_called()

    @pytest.mark.parametrize(
        "source_url",
        [
            "rtsp://localhost:8554/live/x",
            "rtsps://localhost:8555/live/x",
            "http://cam.local/stream.m3u8",
            "https://cam.local/stream.m3u8",
        ],
    )
    def test_allowed_scheme_is_accepted(self, client, mock_mgr, source_url):
        mock_mgr.register_source.return_value = {"status": "started", "source_id": "cam1"}
        resp = client.post(
            "/register_source", json={"source_id": "cam1", "source_url": source_url}
        )
        assert resp.status_code == 200, source_url

    def test_scheme_check_is_case_insensitive(self, client, mock_mgr):
        resp = client.post(
            "/register_source",
            json={"source_id": "cam1", "source_url": "FILE:///etc/shadow"},
        )
        assert resp.status_code == 400

    def test_file_source_allowed_when_opted_in(self, mock_manager, monkeypatch):
        """`allow_file_source` exists for offline evaluation against local clips."""
        from fastapi.testclient import TestClient

        import service as service_module
        from service import create_app
        from shared.config import AppConfig

        config = AppConfig(model_dir="/tmp/models")
        config.security.allow_file_source = True
        app = create_app(config)
        with TestClient(app, raise_server_exceptions=False) as tc:
            monkeypatch.setattr(service_module, "_manager", mock_manager)
            mock_manager.register_source.return_value = {
                "status": "started",
                "source_id": "cam1",
            }
            resp = tc.post(
                "/register_source",
                json={"source_id": "cam1", "source_url": "file:///tmp/sample.mp4"},
            )
        assert resp.status_code == 200


class TestConcurrentRegistration:
    def test_concurrent_registration_of_same_id_returns_409(self, client, mock_mgr):
        """Second concurrent register for one id is refused, not queued.

        Queueing would park a threadpool worker through a 20s teardown, which is
        exactly the amplification an unauthenticated caller would want.
        """
        mock_mgr.register_source.return_value = {
            "status": "registration_in_progress",
            "source_id": "cam1",
        }
        resp = client.post(
            "/register_source",
            json={"source_id": "cam1", "source_url": "rtsp://localhost:8554/live/x"},
        )
        assert resp.status_code == 409
        assert resp.json()["detail"]["error"] == "registration_in_progress"


class TestPrefilterUpdateValidation:
    """`POST /pipeline/validate` and `PUT /pipeline` check the *effective* prefilter.

    The effective config is the deployment defaults, then the source's current
    values, then the request — so a partial patch is validated against the
    model the source is actually on.
    """

    def test_preview_validates_merged_classes_without_updating(self, client, mock_mgr, tmp_path):
        name, stub = register_model(client, tmp_path, class_names=("cat", "dog"))
        mock_mgr.get_source_status.return_value = {
            "pipeline_config": {"prefilter": {
                "enabled": True, "model": name, "target_classes": ["cat"], "min_confidence": .4,
            }}
        }
        with stub:
            resp = client.post(
                "/sources/cam1/pipeline/validate",
                json={"pipeline": {"prefilter": {"target_classes": ["unknown"]}}},
            )
            assert resp.status_code == 422
            mock_mgr.update_pipeline_config.assert_not_called()
            resp = client.post(
                "/sources/cam1/pipeline/validate",
                json={"pipeline": {"prefilter": {"min_frames_hit": 3, "detect_fps": 4, "long_side": 0}}},
            )
        assert resp.status_code == 200
        body = resp.json()["prefilter"]
        assert body["enabled"] is True
        assert body["model"] == name
        assert body["target_classes"] == ["cat"]
        assert body["min_frames_hit"] == 3
        mock_mgr.update_pipeline_config.assert_not_called()

    @pytest.mark.parametrize("patch", [{"nms_iou": .5}, {"min_frames_hit": 0}, {"detect_fps": 0}, {"long_side": -1}])
    def test_invalid_fields_never_update(self, client, mock_mgr, patch):
        resp = client.post("/sources/cam1/pipeline/validate", json={"pipeline": {"prefilter": patch}})
        assert resp.status_code == 422
        mock_mgr.update_pipeline_config.assert_not_called()

    def test_commit_validates_partial_classes_against_current_model(self, client, mock_mgr, tmp_path):
        name, stub = register_model(client, tmp_path, name="custom", class_names=("cat",))
        mock_mgr.get_source_status.return_value = {
            "pipeline_config": {"prefilter": {"enabled": True, "model": name, "target_classes": ["cat"]}}
        }
        with stub:
            resp = client.put(
                "/sources/cam1/pipeline",
                json={"pipeline": {"prefilter": {"target_classes": ["person"]}}},
            )
        assert resp.status_code == 422
        mock_mgr.update_pipeline_config.assert_not_called()

    def test_request_model_path_is_rejected_by_validate(self, client, mock_mgr):
        mock_mgr.get_source_status.return_value = {"pipeline_config": {}}
        resp = client.post(
            "/sources/cam1/pipeline/validate",
            json={"pipeline": {"prefilter": {"model_path": "/etc/passwd"}}},
        )
        assert resp.status_code == 422
        assert resp.json()["detail"]["error"] == "model_path is not accepted"

    def test_disabling_prefilter_never_needs_a_usable_model(self, client, mock_mgr):
        """Turning prefilter off must work even when its model is unavailable."""
        mock_mgr.get_source_status.return_value = {
            "pipeline_config": {"prefilter": {"enabled": True, "model": "gone"}}
        }
        resp = client.post(
            "/sources/cam1/pipeline/validate",
            json={"pipeline": {"prefilter": {"enabled": False}}},
        )
        assert resp.status_code == 200
        assert resp.json()["prefilter"]["enabled"] is False

    def test_validate_switches_to_a_registered_model_and_reports_its_path(self, client, mock_mgr, tmp_path):
        name, stub = register_model(client, tmp_path, name="other", class_names=("person",))
        mock_mgr.get_source_status.return_value = {
            "pipeline_config": {"prefilter": {"enabled": True, "model": "yolo11s", "target_classes": ["person"]}}
        }
        with stub:
            resp = client.post(
                "/sources/cam1/pipeline/validate",
                json={"pipeline": {"prefilter": {"model": name}}},
            )
        assert resp.status_code == 200
        assert resp.json()["prefilter"]["model"] == name
        assert resp.json()["prefilter"]["model_path"] == str(tmp_path / f"{name}.xml")

    def test_roi_requires_prefilter(self, client, mock_mgr):
        mock_mgr.get_source_status.return_value = {"pipeline_config": {"prefilter": {"enabled": False}}}
        resp = client.post(
            "/sources/cam1/pipeline/validate",
            json={"pipeline": {"roi": {"enabled": True}}},
        )
        assert resp.status_code == 422

