#!/bin/bash -e

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MODEL_PATH="${APP_DIR}/src/dlstreamer-pipeline-server/models/public/yolo11s/INT8/yolo11s.xml"

if [ ! -e "${MODEL_PATH}" ]; then
    echo
    echo "The Smart Parking sample uses the YOLOv11s model for object detection."
    echo "This model is provided by Ultralytics and is subject to its license:"
    echo "  https://github.com/ultralytics/ultralytics/blob/main/LICENSE"
    echo "Disclaimer: by downloading and using this model, you confirm that you accept the"
    echo "license terms and agree to comply with any applicable model-use and privacy requirements."
    while true; do
        read -r -p "Proceed with the YOLOv11s model download and usage? [y/N]: " answer
        case "${answer:-N}" in
            [Yy]|[Yy][Ee][Ss])
                echo "Continuing with the YOLOv11s model download..."
                break
                ;;
            *)
                echo "YOLOv11s model download cancelled. Exiting install.sh."
                exit 1
                ;;
        esac
    done
fi

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
MODE="${2:-def}"

# Link names mounted by the compose files -> "<default target>|<scenescape target>" (same dir).
# An empty target means the link must not exist in that mode.
declare -A CONFIG_LINKS=(
  [src/dlstreamer-pipeline-server/config.json]="config_without_scenescape.json|config_scenescape.json"
  [src/grafana/datasources.yml]="datasources_without_scenescape.yml|datasources_scenescape.yml"
  [src/node-red/flows.json]="flows_without_scenescape.json|flows_scenescape.json"
  [src/node-red/install_package.sh]="install_package_without_scenescape.sh|install_package_scenescape.sh"
  [src/node-red/flows_cred.json]="|flows_cred_scenescape.json"
)

link_target() {
  IFS='|' read -r def_target ss_target <<< "${CONFIG_LINKS[$1]}"
  if [ "$MODE" = "ss" ]; then echo "$ss_target"; else echo "$def_target"; fi
}

# Validate everything first so a failure leaves the current links untouched
for link in "${!CONFIG_LINKS[@]}"; do
  target="$(link_target "$link")"
  if [ -n "$target" ] && [ ! -e "${SCRIPT_DIR}/$(dirname "$link")/${target}" ]; then
    echo "Error: $(dirname "$link")/${target} not found for '${MODE}' mode."
    exit 1
  fi
done

echo "Linking configuration files for '${MODE}' mode..."
for link in "${!CONFIG_LINKS[@]}"; do
  link_path="${SCRIPT_DIR}/${link}"
  target="$(link_target "$link")"
  if [ -L "$link_path" ]; then
    unlink "$link_path"
  fi
  # Nothing to link in this mode; leave any runtime-generated file (e.g. Node-RED settings.js) alone
  if [ -z "$target" ]; then
    continue
  fi
  # A regular file here means it was edited in place (e.g. Node-RED Deploy); keep it instead of overwriting
  if [ -e "$link_path" ]; then
    backup="${link_path}.user-$(date +%Y%m%d-%H%M%S)"
    mv "$link_path" "$backup"
    echo "  WARNING: ${link} was a regular file, saved as $(basename "$backup")"
  fi
  ln -s "$target" "$link_path"
  echo "  ${link} -> ${target}"
done

host_timezone() {
    local tz
    tz=$(timedatectl show -p Timezone --value 2>/dev/null)
    if [ -z "$tz" ] && [ -f /etc/timezone ]; then
        tz=$(cat /etc/timezone)
    fi
    if [ -z "$tz" ]; then
        tz=$(readlink -f /etc/localtime 2>/dev/null | sed -n 's|.*/zoneinfo/||p')
    fi
    echo "${tz:-UTC}"
}

# Configure or clean up smart-parking specific environment variables in the parent .env file
ENV_FILE="${SCRIPT_DIR}/../.env"
if [ -f "$ENV_FILE" ]; then
  # Remove any existing smart-parking SceneScape settings first
  sed -i -e '/^# SceneScape settings for smart-parking/d' \
         -e '/^\(SCENESCAPE_ENABLED\|SS_INFLUX_BUCKET\|SS_MODELS_SRC\|SS_MODELS_TARGET\|SS_ENABLE_WEBRTC\|SS_TZ\|COMPOSE_PROFILES\)=/d' "$ENV_FILE"
  sed -i -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$ENV_FILE"

  if [ "$MODE" = "ss" ]; then
    cat >> "$ENV_FILE" <<EOF

# SceneScape settings for smart-parking
SCENESCAPE_ENABLED=true
SS_INFLUX_BUCKET=SS-Parking
SS_MODELS_SRC=models
SS_MODELS_TARGET=/home/pipeline-server/models
SS_ENABLE_WEBRTC=true
SS_TZ=$(host_timezone)
COMPOSE_PROFILES=smart-parking-scenescape
EOF
  fi
fi

if [ "$MODE" = "ss" ]; then
  bash "${SCRIPT_DIR}/init-scenescape.sh"
fi

# Self-guarded: generates Node-RED admin credentials or backfills if missing
docker run --rm -t --user "$(id -u):$(id -g)" \
  -e http_proxy -e https_proxy -e no_proxy \
  -v "$SCRIPT_DIR/src/secrets:/src/secrets" \
  docker.io/library/python:3.12 bash /src/secrets/generate_nodered_secret.sh

docker run --rm --user=root \
  -e http_proxy -e https_proxy -e no_proxy \
  -e YOLOV11S_DOWNLOAD_CONFIRMED=1 \
  -v "${APP_DIR}:/opt/project" \
   intel/dlstreamer:2026.3.0-ubuntu24-rc1 bash -c "$(cat <<EOF

cd /opt/project
export HOST_IP="${1:-$(hostname -I | cut -f1 -d' ')}"
echo "Configuring application to use \$HOST_IP"

# shellcheck disable=SC1091
. ./update_dashboard.sh \$HOST_IP

##############################################################################
# 4. Process YOLO model (if any)
##############################################################################
mkdir -p src/dlstreamer-pipeline-server/models/public

export MODELS_PATH=/opt/project/src/dlstreamer-pipeline-server/models
chmod +x /home/dlstreamer/dlstreamer/samples/download_public_models.sh
if [ ! -e "src/dlstreamer-pipeline-server/models/public/yolo11s/INT8/yolo11s.xml" ]; then
    if [ "\${YOLOV11S_DOWNLOAD_CONFIRMED:-0}" != "1" ]; then
        echo "YOLOv11s model download requires explicit confirmation."
        exit 1
    fi

    for attempt in {1..3}; do
        echo "Attempt $attempt: Running model download and quantization..."
        if /home/dlstreamer/dlstreamer/samples/download_public_models.sh yolo11s coco128; then
            echo "Model download and quantization successful!"
            break
        else
            echo "Download attempt $attempt failed. Retrying..."
            sleep 2
        fi
    done
fi

##############################################################################
# Download and setup videos
##############################################################################
mkdir -p src/dlstreamer-pipeline-server/videos
declare -A video_urls=(
    ["new_video_1.mp4"]="https://github.com/open-edge-platform/edge-ai-resources/raw/0d39322d6c6c578413cdf2a3d48c4e0978531e10/videos/smart_parking_720p_30fps.mp4"
    ["new_video_2.mp4"]="https://github.com/open-edge-platform/edge-ai-resources/raw/0d39322d6c6c578413cdf2a3d48c4e0978531e10/videos/smart_parking_720p_30fps.mp4"
    ["new_video_3.mp4"]="https://github.com/open-edge-platform/edge-ai-resources/raw/0d39322d6c6c578413cdf2a3d48c4e0978531e10/videos/smart_parking_720p_30fps.mp4"
    ["new_video_4.mp4"]="https://github.com/open-edge-platform/edge-ai-resources/raw/0d39322d6c6c578413cdf2a3d48c4e0978531e10/videos/smart_parking_720p_30fps.mp4"
)
for video_name in "\${!video_urls[@]}"; do
    if [ ! -f src/dlstreamer-pipeline-server/videos/\${video_name} ]; then
        echo "Download \${video_name}..."
        curl -f -L -o "src/dlstreamer-pipeline-server/videos/\${video_name}" "\${video_urls[\$video_name]}"
    fi
done

for video_name in "\${!video_urls[@]}"; do
    if [ ! -f "src/dlstreamer-pipeline-server/videos/\${video_name}" ]; then
        echo "Error: Failed to download \${video_name}"
        exit 1
    fi
done

echo "Fix ownership..."
chown -R "$(id -u):$(id -g)" src/dlstreamer-pipeline-server/models src/dlstreamer-pipeline-server/videos 2>/dev/null || true

mkdir -p src/nginx/ssl
cd src/nginx/ssl
if [ ! -f server.key ] || [ ! -f server.crt ]; then
    echo "Generate self-signed certificate..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout server.key -out server.crt -subj "/C=US/ST=CA/L=San Francisco/O=Intel/OU=Edge AI/CN=localhost"
    chown -R "$(id -u):$(id -g)" server.key server.crt 2>/dev/null || true

fi

EOF

)"