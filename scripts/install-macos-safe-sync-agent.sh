#!/usr/bin/env bash
# Install LaunchAgent: fetch/pull every 10 min if tracked-clean; notify otherwise.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.resell.gitsafe-sync"
PLIST_SRC="$ROOT/deploy/macos/${LABEL}.plist"
PLIST_DST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
WRAPPER="$ROOT/scripts/safe-sync-launchd.sh"

if [ ! -f "$WRAPPER" ]; then
  echo "missing $WRAPPER"
  exit 1
fi
chmod +x "$ROOT/scripts/safe-sync.sh" "$ROOT/scripts/safe-push.sh" "$WRAPPER"

mkdir -p "${HOME}/Library/LaunchAgents" "${HOME}/Library/Logs/resell"

# Rewrite plist with this machine's absolute paths
python3 - "$PLIST_SRC" "$PLIST_DST" "$WRAPPER" <<'PY'
import sys
src, dst, wrapper = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(src).read()
text = text.replace("__SAFE_SYNC_WRAPPER__", wrapper)
open(dst, "w").write(text)
print(f"wrote {dst}")
PY

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/${LABEL}" 2>/dev/null || launchctl start "$LABEL" || true

echo "Installed $LABEL"
echo "Logs: ~/Library/Logs/resell/safe-sync.log"
echo "Unload: launchctl bootout gui/$(id -u)/${LABEL}"
