# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import asyncio
import os
import sys

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
)

from controllers.live_traffic import LiveTrafficController  # noqa: E402


def test_websocket_url_uses_scheme_and_configured_endpoint(monkeypatch):
    urls = []
    controller = LiveTrafficController()

    monkeypatch.setattr(
        "controllers.live_traffic.read_config_json",
        lambda: {
            "api_endpoint": "/api/v1/traffic/current/ws?images=false",
            "api_hosts": [{"host": "intersection-agent:8081"}],
        },
    )

    async def capture_url(url):
        urls.append(url)
        return None

    monkeypatch.setattr(controller, "_plug_to_websocket", capture_url)

    asyncio.run(controller.fetch_route_status())

    assert urls == [
        "ws://intersection-agent:8081/api/v1/traffic/current/ws?images=false"
    ]
