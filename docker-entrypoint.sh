#!/bin/sh
set -e

if [ "${PLAYWRIGHT_USE_XVFB:-1}" = "1" ]; then
  export DISPLAY="${DISPLAY:-:99}"
  Xvfb "${DISPLAY}" -screen 0 1280x720x24 >/tmp/xvfb.log 2>&1 &
fi

exec npm start
