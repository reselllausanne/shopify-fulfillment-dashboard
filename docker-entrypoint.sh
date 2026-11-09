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

# Galaxus night buyer: runs while /app/.data/night-buyer.on exists (kill switch = delete it).
# Restarts after crash or redeploy. Halt file .data/night-buyer.halt pauses it.
if [ -f /app/.data/night-buyer.on ]; then
  (
    sleep 40
    while [ -f /app/.data/night-buyer.on ]; do
      NIGHT_BUYER_UNTIL="${NIGHT_BUYER_UNTIL:-2026-11-05}" NIGHT_BUYER_SINCE="${NIGHT_BUYER_SINCE:-2026-10-22}" npx tsx scripts/galaxus-night-buyer.ts >>/app/.data/night-buyer.log 2>&1
      sleep 20
    done
  ) &
fi

if [ $# -gt 0 ]; then
  exec "$@"
else
  exec npm start
fi
