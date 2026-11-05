#!/bin/bash

# Path to the .env file
ENV_FILE="./.env"

# Check if .env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: .env file not found."
    exit 1
fi

# Check and set SAMPLE_APP from first argument
SAMPLE_APP_ARG="$1"
if [ -z "$SAMPLE_APP_ARG" ]; then
    echo "Error: First argument (SAMPLE_APP) is required."
    echo "Usage: $0 <smart-parking|loitering-detection|loitering-detection-ui|smart-intersection> [ss] [HOST_IP]"
    exit 1
fi

# "loitering-detection-ui" is loitering-detection plus the opt-in Console UI
# service, so it maps onto the same SAMPLE_APP as the plain app and only
# flips ENABLE_UI, which the per-app install.sh reads to decide whether to add that
# service to docker-compose.yml.
ENABLE_UI_ARG="false"
if [ "$SAMPLE_APP_ARG" = "loitering-detection-ui" ]; then
    SAMPLE_APP_ARG="loitering-detection"
    ENABLE_UI_ARG="true"
fi

# Optional second argument "ss" selects the SceneScape variant; HOST_IP then shifts to the third argument
SCENESCAPE_ENABLED=false
HOST_IP_ARG="$2"
if [ "$2" = "ss" ]; then
    SCENESCAPE_ENABLED=true
    HOST_IP_ARG="$3"
fi

case "$SAMPLE_APP_ARG" in
    "smart-parking"|"loitering-detection"|"smart-intersection")
        # Update SAMPLE_APP in .env file
        if grep -q "^SAMPLE_APP=" "$ENV_FILE"; then
            sed -i "s/^SAMPLE_APP=.*/SAMPLE_APP=$SAMPLE_APP_ARG/" "$ENV_FILE"
        else
            echo "SAMPLE_APP=$SAMPLE_APP_ARG" >> "$ENV_FILE"
        fi
        ;;
    *)
        echo "Error: Invalid SAMPLE_APP value '$SAMPLE_APP_ARG'. Must be one of: smart-parking, loitering-detection, loitering-detection-ui, smart-intersection."
        exit 1
        ;;
esac

# Update the HOST_IP in .env file
# Use HOST_IP from the command line if provided, otherwise use hostname -I
if [ -z "$HOST_IP_ARG" ]; then
    HOST_IP=$(hostname -I | cut -f1 -d' ')
else
    # Validate IP format (basic validation for IPv4)
    if [[ ! $HOST_IP_ARG =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "Warning: Invalid IP format. Using hostname -I instead."
        HOST_IP=$(hostname -I | cut -f1 -d' ')
    else
        HOST_IP=$HOST_IP_ARG
    fi
fi

echo "Configuring application to use $HOST_IP"
if grep -q "^HOST_IP=" "$ENV_FILE"; then
    # Replace existing HOST_IP line
    sed -i "s/^HOST_IP=.*/HOST_IP=$HOST_IP/" "$ENV_FILE"
else
    # Add HOST_IP if it doesn't exist
    echo "HOST_IP=$HOST_IP" >> "$ENV_FILE"
fi

# Extract SAMPLE_APP variable from .env file
SAMPLE_APP=$(grep -E "^SAMPLE_APP=" "$ENV_FILE" | cut -d '=' -f2 | tr -d '"' | tr -d "'")

# Bring down the application before updating docker compose file
if docker compose ps >/dev/null 2>&1; then
    echo "Bringing down any running containers..."
    docker compose down -v --remove-orphans
fi

# Clean up any existing smart-parking SceneScape settings from .env
# (smart-parking/install.sh will re-add them if 'ss' mode is selected)
sed -i -e '/^# SceneScape settings for smart-parking/d' \
       -e '/^\(SCENESCAPE_ENABLED\|SS_INFLUX_BUCKET\|SS_MODELS_SRC\|SS_MODELS_TARGET\|SS_ENABLE_WEBRTC\|SS_TZ\|COMPOSE_PROFILES\)=/d' "$ENV_FILE"
sed -i -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$ENV_FILE"

# Copy appropriate docker-compose file
if [ "$SAMPLE_APP" = "smart-intersection" ] || [ "$SCENESCAPE_ENABLED" = "true" ]; then
    cp compose-scenescape.yml docker-compose.yml
else
    cp compose-without-scenescape.yml docker-compose.yml
fi

# Check if the directory exists
if [ ! -d "$SAMPLE_APP" ]; then
    echo "Error: Directory $SAMPLE_APP does not exist."
    exit 1
fi

# Navigate to the directory and run the install script
echo "Navigating to $SAMPLE_APP directory and running install script..."
cd "$SAMPLE_APP" || exit 1

if [ -f "./install.sh" ]; then
    chmod +x ./install.sh
    if [ "$SCENESCAPE_ENABLED" = "true" ]; then
        ENABLE_UI="$ENABLE_UI_ARG" ./install.sh "$HOST_IP" ss
    else
        ENABLE_UI="$ENABLE_UI_ARG" ./install.sh $HOST_IP
    fi
else
    echo "Error: install.sh not found in $SAMPLE_APP directory."
    exit 1
fi