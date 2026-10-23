#!/bin/sh
set -e

export DISPLAY="${DISPLAY:-:99}"
if [ "${PLAYWRIGHT_USE_XVFB:-1}" = "1" ]; then
  Xvfb "${DISPLAY}" -screen 0 1280x720x24 >/tmp/xvfb.log 2>&1 &
fi

if [ "${PLAYWRIGHT_ENABLE_REMOTE_DESKTOP:-0}" = "1" ]; then
  fluxbox >/tmp/fluxbox.log 2>&1 &
  x11vnc -display "${DISPLAY}" -forever -shared -rfbport 5900 -passwd "${VNC_PASSWORD:-1234}" >/tmp/x11vnc.log 2>&1 &
  websockify --web=/usr/share/novnc 6080 localhost:5900 >/tmp/novnc.log 2>&1 &
fi

# Vacation warm Chromium (CDP 9222/9223). Remint attaches instead of cold Turnstile launch.
# Set STOCKX_WARM_DAEMON=0 to disable (interactive login / debugging).
if [ "${STOCKX_WARM_DAEMON:-1}" = "1" ] && [ "${PLAYWRIGHT_USE_XVFB:-1}" = "1" ]; then
  (
    sleep 8
    npx tsx scripts/stockx-warm-daemon.ts both >>/tmp/stockx-warm-daemon.log 2>&1
  ) &
fi

if [ $# -gt 0 ]; then
  exec "$@"
else
  exec npm start
fi
