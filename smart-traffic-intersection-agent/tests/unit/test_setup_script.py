# SPDX-FileCopyrightText: (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Tests for setup script defaults without deploying services."""

import os
import subprocess
from pathlib import Path

import pytest

SETUP_SCRIPT = Path(__file__).resolve().parents[2] / "setup.sh"


def run_setup(command, env=None, args=(), expected_returncode=0):
    test_env = {"PATH": os.defpath, "VLM_MODEL_NAME": "test/model", **(env or {})}
    result = subprocess.run(
        [
            "bash",
            "--noprofile",
            "--norc",
            "-c",
            'source "$1" --setenv >/dev/null && ' + command,
            "bash",
            str(SETUP_SCRIPT),
            *map(str, args),
        ],
        env={key: value for key, value in test_env.items() if value is not None},
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert result.returncode == expected_returncode, result.stderr
    return result


@pytest.mark.parametrize(
    "model",
    [
        "OpenVINO/Phi-3.5-vision-instruct-int8-ov",
        "OpenVINO/Qwen2-VL-2B-Instruct-int4-ov",
    ],
)
def test_setup_exports_selected_model(model):
    result = run_setup("printenv VLM_MODEL_NAME", {"VLM_MODEL_NAME": model})
    assert result.stdout.strip() == model


@pytest.mark.parametrize("model", [None, ""])
def test_setup_requires_explicit_model_selection(model):
    result = run_setup(
        "printenv VLM_MODEL_NAME",
        {"VLM_MODEL_NAME": model},
        expected_returncode=1,
    )
    assert "VLM_MODEL_NAME is required" in result.stderr


@pytest.mark.parametrize(
    ("vendors", "render_device", "expected"),
    [
        ([], True, "CPU"),
        (["0x8086"], True, "GPU"),
        (["0x1002"], True, "CPU"),
        (["0x1002", "0x8086"], True, "GPU"),
        (["0x8086"], False, "CPU"),
    ],
)
def test_detect_vlm_target_device(tmp_path, vendors, render_device, expected):
    dri = tmp_path / "dri"
    drm = tmp_path / "drm"
    dri.mkdir()
    drm.mkdir()
    for index, vendor in enumerate(vendors, start=128):
        name = f"renderD{index}"
        device = drm / name / "device"
        device.mkdir(parents=True)
        (device / "vendor").write_text(vendor + "\n")
        if render_device:
            (dri / name).symlink_to("/dev/null")

    result = run_setup(
        'detect_vlm_target_device "$2" "$3"',
        {"VLM_TARGET_DEVICE": "CPU"},
        (dri, drm),
    )
    assert result.stdout.strip() == expected


@pytest.mark.parametrize(
    ("device", "si_device", "image_tag", "expected_si"),
    [
        ("CPU", "GPU", "2026.4.0", "GPU"),
        ("GPU", "GPU", "2026.4.0-gpu", "CPU"),
        ("GPU", "NPU", "2026.4.0-gpu", "CPU"),
    ],
)
def test_device_override_configures_ovms_and_si(
    device, si_device, image_tag, expected_si
):
    result = run_setup(
        "printenv VLM_TARGET_DEVICE OVMS_TAG TC_SI_TARGET_DEVICE",
        {"VLM_TARGET_DEVICE": device, "TC_SI_TARGET_DEVICE": si_device},
    )
    assert result.stdout.splitlines() == [device, image_tag, expected_si]


@pytest.mark.parametrize("device", [None, ""])
def test_setup_automatically_selects_host_device(device):
    env = {}
    if device is not None:
        env["VLM_TARGET_DEVICE"] = device
    result = run_setup(
        "printenv VLM_TARGET_DEVICE OVMS_TAG; detect_vlm_target_device /dev/dri /sys/class/drm",
        env,
    )
    selected, image_tag, detected = result.stdout.splitlines()
    assert selected == detected
    assert image_tag == ("2026.4.0-gpu" if detected == "GPU" else "2026.4.0")
