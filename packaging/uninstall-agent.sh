#!/bin/bash
set -euo pipefail

LABEL="com.vdo-multichan.comms"
DEST="${HOME}/Library/LaunchAgents/${LABEL}.plist"

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
rm -f "${DEST}"
echo "Removed ${LABEL}"
