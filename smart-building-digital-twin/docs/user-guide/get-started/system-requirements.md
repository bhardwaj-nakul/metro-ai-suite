# System Requirements

This section provides the hardware, software, and platform requirements to set up and
run the application.

## Supported Platforms

**Operating Systems**

- Ubuntu 24.04 LTS
- Ubuntu 26.04 LTS

## Minimum Requirements

| **Component**       | **Minimum Requirement** |
|---------------------|-------------------------|
| **Processor**       | Intel® Core™ Ultra Processor (Series 1 and above) or Intel® Core™ Processor Series 3, with Intel® HD Graphics |
| **GPU/Accelerator** | Integrated GPU (recommended; CPU fallback supported) |
| **Memory**          | 32 GB                   |
| **Disk Space**      | 128 GB SSD              |

## Validated Platforms

| Product / Family                               | CPU | iGPU | NPU |
|------------------------------------------------|-----|------|-----|
| Intel® Core™ Ultra Processors (Series 3, 2, 1) | ✓   | ✓    | ✓   |
| Intel® Core™ Processors Series 3               | ✓   | ✓    | ✓   |

## GPU and Telemetry Setup

- An Intel® GPU is recommended. If none is available, the application runs on the CPU.
- On Panther Lake systems, install `xpu-smi` on the host before running `./setup.sh`
  to enable `xe` GPU telemetry. On Ubuntu 24.04, with the Intel graphics repository or
  PPA already configured, run:

  ```bash
  sudo apt install xpu-smi
  ```

- If the GPU name is still shown as a raw Peripheral Component Interconnect (PCI) ID
  after installing `xpu-smi`, refresh the host PCI ID database:

  ```bash
  sudo update-pciids
  ```

## Software Requirements

- Docker Engine
- Docker Compose tool
- Python 3 programming language
- OpenSSL toolkit
- jq tool
- Install the Git Large File Storage (LFS) extension **before** cloning, for video file storage:

  ```bash
  # Ubuntu/Debian
  sudo apt install git-lfs
  git lfs install
  ```
