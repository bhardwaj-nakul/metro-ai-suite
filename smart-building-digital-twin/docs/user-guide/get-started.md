# Get Started

<!-- - **Time to Complete:** <TODO>-->
- **Programming Language:**  Python 3

## Prerequisites

- [System Requirements](./get-started/system-requirements.md)

## Clone the Repository

> [!NOTE]
> Ensure you have the Git LFS extension (for handling scene bundles) installed before
> cloning the repository.

Clone the repository:

```bash
git clone --filter=blob:none --sparse --branch main https://github.com/open-edge-platform/metro-ai-suite.git
cd metro-ai-suite
git sparse-checkout set smart-building-digital-twin
cd smart-building-digital-twin
```

## Run setup

From the project root, run:

```bash
./setup.sh
```

The setup script:

- prompts for an admin password (`SUPASS`) and a database password (`DATABASE_PASSWORD`)
- generates TLS certificates
- starts all services
- waits for the API
- imports the included Showcase scene automatically
- performs a best-effort telemetry check

If `xpu-smi` is already installed on the host, `./setup.sh` also grants the needed host
access for `xpu-smi`, starts the host GPU telemetry bridge, and verifies that the
analytics service can read telemetry. If you install `xpu-smi` after the initial deployment,
rerun `./setup.sh`.

The analytics service learns the `SideDoorEntry` door-state baseline only after the first
complete replay loop, preventing partial data from a mid-loop startup from affecting the baseline.

## After Setup

After setup completes, you can access these runtime endpoints:

- Scenescape web UI: `SCENESCAPE_UI_URL` from `.env` (accept the self-signed certificate)
  This is the Scenescape management interface for the simulated building scene.
  You can use the interface to edit object classes, camera transforms, and regions.
  Its default is https://PUBLIC_HOSTNAME; the browser must accept the generated self-signed
  certificate. The setup output provides the admin credentials.

- Analytics dashboard: `DASHBOARD_URL` from `.env`
  This is a separate custom FastAPI web UI served by scripts/dashboard.py. It displays live scene state,
  people, bag, and door counts, region occupancy, system telemetry, narrated events, alerts,
  and camera snapshots. Its default is http://PUBLIC_HOSTNAME:7000.

## Next Steps

- [How It Works](./how-it-works.md)
- [How to Use the Application](./how-to-use-application.md)
- [Troubleshooting](./troubleshooting.md)
- [Release Notes](./release-notes.md)

<!--hide_directive
:::{toctree}
:hidden:

./get-started/system-requirements

:::
hide_directive-->
