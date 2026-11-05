# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Standalone FastAPI server exposing a single endpoint, `/v1/intersections`, that
aggregates live intersection data from the Smart-Traffic-Intersection Agent
instances listed in `data/config.json`.

This module is fully independent from the Gradio Route Planner app in
`main.py`: it can be deleted, along with its single call to
`start_in_background()` in `main.py`, without affecting any other behavior.
"""

import asyncio
import os
import re
import threading
from typing import Dict, List, Optional, Tuple

import httpx
import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from utils.helper import read_config_json
from utils.logging_config import get_logger

logger = get_logger(__name__)

DEFAULT_PORT = 8765
REQUEST_TIMEOUT_SECONDS = 5.0
CAMERA_DIRECTIONS = ["south", "west", "north", "east"]

FetchStatus = str  # one of "ok", "no_data", "unreachable"


class CameraInfo(BaseModel):
    lat: float
    lon: float
    direction: str
    label: str


class IntersectionInfo(BaseModel):
    label: str
    lat: float
    lon: float
    cameras: Dict[str, CameraInfo]


class IntersectionsResponse(BaseModel):
    version: int = 1
    intersections: Dict[str, IntersectionInfo] = {}


class ErrorResponse(BaseModel):
    detail: str


def _build_intersection(
    key: str, name: str, lat: float, lon: float
) -> IntersectionInfo:
    """Build an intersection entry with one synthetic camera per direction."""

    cameras = {
        f"{key}-camera{index}": CameraInfo(
            lat=lat, lon=lon, direction=direction, label=f"{name}-{direction}"
        )
        for index, direction in enumerate(CAMERA_DIRECTIONS, start=1)
    }
    label = re.sub(r"[^A-Za-z0-9]+", " ", name).strip()
    if label:
        label = label[0].upper() + label[1:]
    return IntersectionInfo(label=label, lat=lat, lon=lon, cameras=cameras)


async def _fetch_intersection(
    client: httpx.AsyncClient, host: str, endpoint: str
) -> Tuple[FetchStatus, Optional[dict]]:
    """Fetch traffic data from a single Smart-Traffic-Intersection Agent instance."""

    url = f"http://{host}{endpoint}"
    try:
        response = await client.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
    except httpx.HTTPError as e:
        logger.warning(f"Intersection agent at {url} is unreachable: {e}")
        return "unreachable", None

    if response.status_code == 404:
        return "no_data", None
    if response.status_code != 200:
        logger.warning(
            f"Intersection agent at {url} returned status {response.status_code}"
        )
        return "unreachable", None

    try:
        return "ok", response.json()["data"]
    except (KeyError, ValueError) as e:
        logger.warning(f"Unexpected response from {url}: {e}")
        return "unreachable", None


async def _fetch_all(
    api_hosts: List[dict], endpoint: str
) -> List[Tuple[FetchStatus, Optional[dict]]]:
    async with httpx.AsyncClient() as client:
        return await asyncio.gather(
            *(_fetch_intersection(client, host["host"], endpoint) for host in api_hosts)
        )


async def get_intersections() -> Tuple[int, BaseModel]:
    """Aggregate live intersection data and return an (HTTP status code, body) pair."""

    config = read_config_json()
    api_hosts = config.get("api_hosts", [])
    endpoint = config.get("http_api_endpoint", "")

    results = await _fetch_all(api_hosts, endpoint)

    intersections: Dict[str, IntersectionInfo] = {}
    unreachable_hosts: List[str] = []
    for host, (status, data) in zip(api_hosts, results):
        if status == "ok":
            name = data["intersection_name"]
            key = name
            intersections[key] = _build_intersection(
                key, name, data["latitude"], data["longitude"]
            )
        elif status == "unreachable":
            unreachable_hosts.append(f"http://{host['host']}")

    if intersections:
        return 200, IntersectionsResponse(intersections=intersections)

    if unreachable_hosts:
        detail = f"Intersection agent(s) unreachable: {', '.join(unreachable_hosts)}"
        return 503, ErrorResponse(detail=detail)

    return 200, IntersectionsResponse()


app = FastAPI(title="Smart Route Planning Agent - Intersections API")


@app.get(
    "/v1/intersections",
    response_model=IntersectionsResponse,
    responses={503: {"model": ErrorResponse}},
)
async def intersections_endpoint() -> JSONResponse:
    status_code, body = await get_intersections()
    return JSONResponse(status_code=status_code, content=body.model_dump())


def run_server(host: str = "0.0.0.0", port: Optional[int] = None) -> None:
    port = port or int(os.getenv("INTERSECTIONS_API_PORT", DEFAULT_PORT))
    uvicorn.run(app, host=host, port=port, log_level="info")


def start_in_background(
    host: str = "0.0.0.0", port: Optional[int] = None
) -> threading.Thread:
    """Run the intersections API server on a daemon thread alongside the caller."""

    thread = threading.Thread(
        target=run_server, kwargs={"host": host, "port": port}, daemon=True
    )
    thread.start()
    return thread


if __name__ == "__main__":
    run_server()
