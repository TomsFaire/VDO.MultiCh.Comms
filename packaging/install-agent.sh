#!/bin/bash
set -euo pipefail

LABEL="com.vdo-multichan.comms"
PRODUCT="VDO.MultiCh.Comms"
APP_PATH="${1:-/Applications/${PRODUCT}.app}"
SRC="$(cd "$(dirname "$0")" && pwd)/${LABEL}.plist"
DEST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="${HOME}/Library/Logs/${PRODUCT}"

if [ ! -x "${APP_PATH}/Contents/MacOS/${PRODUCT}" ]; then
  echo "App binary not found at ${APP_PATH}/Contents/MacOS/${PRODUCT}" >&2
  echo "Usage: $0 [/path/to/${PRODUCT}.app]" >&2
  exit 1
fi

mkdir -p "${LOG_DIR}" "${HOME}/Library/LaunchAgents"
sed -e "s|__APP_PATH__|${APP_PATH}|g" -e "s|__HOME__|${HOME}|g" "${SRC}" > "${DEST}"
plutil -lint "${DEST}" >/dev/null

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "${DEST}"
echo "Installed ${LABEL}; logs in ${LOG_DIR}"
