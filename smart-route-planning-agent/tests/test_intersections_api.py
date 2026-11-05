# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Tests for the standalone `/v1/intersections` API in `src/intersections_api.py`.
Upstream Smart-Traffic-Intersection Agent calls are simulated with
`httpx.MockTransport`, so no real servers or network access are required.
"""

import asyncio
import os
import sys

import httpx

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
)

import intersections_api as api  # noqa: E402

ENDPOINT = "/api/v1/traffic/current?images=false"


def _intersection_payload(name: str, lat: float, lon: float) -> dict:
    return {"data": {"intersection_name": name, "latitude": lat, "longitude": lon}}


def _run(api_hosts, handler, monkeypatch):
    """Run get_intersections() with httpx requests routed through `handler`."""

    monkeypatch.setattr(
        api,
        "read_config_json",
        lambda: {"http_api_endpoint": ENDPOINT, "api_hosts": api_hosts},
    )

    real_async_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        return real_async_client(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(api.httpx, "AsyncClient", client_factory)
    return asyncio.run(api.get_intersections())


def test_all_hosts_succeed_numbers_sequentially(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.scheme == "http"
        assert request.url.path == "/api/v1/traffic/current"
        assert request.url.params["images"] == "false"
        name = f"Intersection_{request.url.port}"
        return httpx.Response(200, json=_intersection_payload(name, 1.0, 2.0))

    api_hosts = [
        {"host": "host-a:1"},
        {"host": "host-b:2"},
    ]
    status, body = _run(api_hosts, handler, monkeypatch)

    assert status == 200
    assert set(body.intersections) == {"Intersection_1", "Intersection_2"}
    assert body.intersections["Intersection_1"].label == "Intersection 1"
    assert body.intersections["Intersection_2"].label == "Intersection 2"


def test_cameras_follow_naming_and_direction_convention():
    intersection = api._build_intersection(
        "Intersection_1", "Intersection_1", 37.5, -122.2
    )

    assert set(intersection.cameras) == {
        "Intersection_1-camera1",
        "Intersection_1-camera2",
        "Intersection_1-camera3",
        "Intersection_1-camera4",
    }
    assert intersection.label == "Intersection 1"
    assert intersection.cameras["Intersection_1-camera1"].direction == "south"
    assert (
        intersection.cameras["Intersection_1-camera1"].label == "Intersection_1-south"
    )
    assert intersection.cameras["Intersection_1-camera4"].direction == "east"
    for camera in intersection.cameras.values():
        assert camera.lat == 37.5
        assert camera.lon == -122.2


def test_only_available_intersection_is_kept(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.port == 1:
            return httpx.Response(
                200, json=_intersection_payload("Intersection_1", 1.0, 2.0)
            )
        if request.url.port == 2:
            return httpx.Response(404, json={"detail": "No traffic data available"})
        raise httpx.ConnectError("connection refused", request=request)

    api_hosts = [
        {"host": "host-a:1"},
        {"host": "host-b:2"},
        {"host": "host-c:3"},
    ]
    status, body = _run(api_hosts, handler, monkeypatch)

    assert status == 200
    assert list(body.intersections) == ["Intersection_1"]
    assert "message" not in body.model_dump()


def test_all_hosts_return_no_data(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"detail": "No traffic data available"})

    api_hosts = [{"host": "host-a:1"}, {"host": "host-b:2"}]
    status, body = _run(api_hosts, handler, monkeypatch)

    assert status == 200
    assert body.intersections == {}
    assert "message" not in body.model_dump()


def test_all_hosts_unreachable_returns_503(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    api_hosts = [{"host": "host-a:1"}, {"host": "host-b:2"}]
    status, body = _run(api_hosts, handler, monkeypatch)

    assert status == 503
    assert "host-a" in body.detail
    assert "host-b" in body.detail


def test_no_configured_hosts_reports_none_available(monkeypatch):
    status, body = _run([], lambda request: httpx.Response(200), monkeypatch)

    assert status == 200
    assert body.intersections == {}
    assert "message" not in body.model_dump()
