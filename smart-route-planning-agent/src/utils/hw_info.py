# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Intel hardware identity (CPU / GPU / NPU) for display in the UI.

Reads the same metrics-manager capabilities API and builds the same strings as
the Smart Intersection hardware info panels (see its custom-metrics/hw_info.py).
"""

import json
import os
import urllib.request

CAPABILITIES_URL = os.getenv(
    "METRICS_MANAGER_URL",
    "http://metrics-manager:9090/api/v1/capabilities?profile=expanded",
)
UNAVAILABLE = "Unavailable"


def get_hardware_info() -> tuple[str, str, str]:
    """Returns display strings for (CPU, GPU, NPU)."""
    try:
        # Bypass any HTTP proxy, metrics-manager is on the local compose network.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(CAPABILITIES_URL, timeout=4) as resp:
            caps = json.load(resp)
    except Exception:
        return UNAVAILABLE, UNAVAILABLE, UNAVAILABLE

    summary = caps.get("platform", {}).get("device_summary", {})
    by_cat: dict = {}
    for dev in caps.get("devices", []):
        if dev.get("present", True):
            by_cat.setdefault(dev.get("category"), []).append(dev)

    # CPU
    cpu = (by_cat.get("cpu") or [{}])[0]
    cores = cpu.get("details", {}).get("cores", {})
    topo = cpu.get("specs", {}).get("topology", {})
    ram_gib = caps.get("platform", {}).get("system_memory", {}).get("installed_gib")
    cpu_text = (
        f"{cpu.get('model') or 'Unknown'}  |  "
        f"{cores.get('physical') or topo.get('physical_cores') or '?'} cores / "
        f"{cores.get('logical') or topo.get('logical_cores') or '?'} threads  |  "
        f"{round(ram_gib) if ram_gib else '?'} GB RAM"
    )

    # GPU
    gpus = by_cat.get("igpu", []) + by_cat.get("dgpu", [])
    gpu_names = sorted(
        {g.get("commercial_reference") or g.get("model") or "Intel GPU" for g in gpus}
    )
    gpu_text = (
        f"{' + '.join(gpu_names) if gpu_names else 'None'}  |  "
        f"iGPU: {summary.get('igpu', len(by_cat.get('igpu', [])))}  |  "
        f"dGPU: {summary.get('dgpu', len(by_cat.get('dgpu', [])))}"
    )

    # NPU
    npus = by_cat.get("npu", [])
    if npus:
        npu = npus[0]
        pci_id = (npu.get("pci_device") or "").lower()
        name = npu.get("commercial_reference") or npu.get("model") or "Intel NPU"
        driver = npu.get("driver") or ""
        npu_text = f"{name}  |  {driver or 'n/a'}  |  PCI {pci_id or 'n/a'}"
    else:
        npu_text = "None"

    return cpu_text, gpu_text, npu_text
