#!/usr/bin/env python3
# Copyright (C) 2026-2027 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Publish static Intel hardware identity (CPU / GPU / NPU) as Prometheus metrics.

Runs inside the metrics-manager container via Telegraf's custom-metrics
inputs.exec hook (/app/custom-metrics, every 10 s). It queries the
metrics-manager capabilities API on localhost and prints three InfluxDB
line-protocol records. With Telegraf's string_as_label=true the string
fields become Prometheus labels:

  hw_cpu_info{model=..., cores=..., threads=..., ram_gb=...} 1
  hw_gpu_info{name=..., igpu=..., dgpu=...}                   1
  hw_npu_info{name=..., present=..., pci_id=..., driver=..., pci_address=...} 1
"""

import json
import sys
import urllib.request

# The expanded profile adds pci_device / driver / sysfs_path for the NPU.
CAPABILITIES_URL = "http://localhost:9090/api/v1/capabilities?profile=expanded"


def esc(value):
    return str(value).replace("\\", "\\\\").replace('"', '\\"')


def line(measurement, fields):
    body = ",".join(f'{k}="{esc(v)}"' for k, v in fields.items())
    return f"{measurement} {body},info=1i"


def main():
    try:
        with urllib.request.urlopen(CAPABILITIES_URL, timeout=4) as resp:
            caps = json.load(resp)
    except Exception:
        # Stay silent so Telegraf does not log noise while the API is starting.
        return 0

    devices = caps.get("devices", [])
    summary = caps.get("platform", {}).get("device_summary", {})
    by_cat = {}
    for dev in devices:
        if dev.get("present", True):
            by_cat.setdefault(dev.get("category"), []).append(dev)

    cpu = (by_cat.get("cpu") or [{}])[0]
    # minimal profile: details.cores.{physical,logical}; expanded: specs.topology.{physical,logical}_cores
    cores = cpu.get("details", {}).get("cores", {})
    topo = cpu.get("specs", {}).get("topology", {})
    ram_gib = caps.get("platform", {}).get("system_memory", {}).get("installed_gib")
    print(line("hw_cpu", {
        "model": cpu.get("model") or "Unknown",
        "cores": cores.get("physical") or topo.get("physical_cores") or "?",
        "threads": cores.get("logical") or topo.get("logical_cores") or "?",
        "ram_gb": round(ram_gib) if ram_gib else "?",
    }))

    gpus = by_cat.get("igpu", []) + by_cat.get("dgpu", [])
    gpu_names = sorted({g.get("commercial_reference") or g.get("model") or "Intel GPU" for g in gpus})
    print(line("hw_gpu", {
        "name": " + ".join(gpu_names) if gpu_names else "None",
        "igpu": summary.get("igpu", len(by_cat.get("igpu", []))),
        "dgpu": summary.get("dgpu", len(by_cat.get("dgpu", []))),
    }))

    npus = by_cat.get("npu", [])
    npu = npus[0] if npus else {}
    pci_id = (npu.get("pci_device") or "").lower()
    name = npu.get("commercial_reference") or npu.get("model") or "Intel NPU"
    driver = npu.get("driver") or ""
    print(line("hw_npu", {
        "name": name if npus else "None",
        "present": 1 if npus else 0,
        "pci_id": pci_id or "n/a",
        "pci_address": npu.get("id") or "n/a",
        "driver": driver or "n/a",
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
