#!/bin/bash

SOURCE="src"
if [ ! -f "${SOURCE}/secrets/browser.auth" ]; then
  bash ${SOURCE}/secrets/generate_secrets.sh
fi

# Self-guarded: also backfills this secret on deployments that already ran
# generate_secrets.sh before adminAuth was introduced.
bash ${SOURCE}/secrets/generate_nodered_secret.sh

if [ ! -f .env ]; then
  touch .env
fi

USER_UID=$(stat -c '%u' "${SOURCE}"/* | sort -rn | head -1)
USER_GID=$(stat -c '%g' "${SOURCE}"/* | sort -rn | head -1)

echo "UID=$USER_UID" > .env
echo "GID=$USER_GID" >> .env

if [ ! -d "${SOURCE}/dlstreamer-pipeline-server/videos" ] || [ -z "$(find "${SOURCE}/dlstreamer-pipeline-server/videos" -type f -name "*.ts" 2>/dev/null)" ]; then
  VIDEO_BRANCH="main"
  VIDEO_URL="https://github.com/open-edge-platform/edge-ai-resources/raw/refs/heads/${VIDEO_BRANCH}/videos"
  VIDEOS=("1122east_h264.ts" "1122west_h264.ts" "1122north_h264.ts" "1122south_h264.ts")
  VIDEO_DIR="${SOURCE}/dlstreamer-pipeline-server/videos"

  mkdir -p "${VIDEO_DIR}"
  
  echo "Downloading videos in parallel..."
  for VIDEO in "${VIDEOS[@]}"; do
    curl -f -L -s "${VIDEO_URL}/${VIDEO}" -o "${VIDEO_DIR}/${VIDEO}" &
  done
  
  # # Dummy download to potentially improve bandwidth allocation
  # curl -k -L -s "${VIDEO_URL}/LICENSE" -o "${VIDEO_DIR}/LICENSE" &
  
  wait
  
  for VIDEO in "${VIDEOS[@]}"; do
    if [ ! -f "${VIDEO_DIR}/${VIDEO}" ]; then
        echo "Error: Failed to download ${VIDEO}"
        exit 1
    fi
  done
fi
