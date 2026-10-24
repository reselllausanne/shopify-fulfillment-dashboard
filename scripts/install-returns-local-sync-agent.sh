#!/usr/bin/env bash
# Poll GitHub every 2 min; ff-only pull returns worktree when clean (other agents' pushes).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.resell.returns-local-sync"
PLIST_SRC="$ROOT/deploy/macos/${LABEL}.plist"
PLIST_DST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
WRAPPER="$ROOT/scripts/returns-local-sync-launchd.sh"

chmod +x "$ROOT/scripts/returns-exchange-auto-sync.sh" \
  "$ROOT/scripts/dev-returns-localhost.sh" \
  "$WRAPPER"

mkdir -p "${HOME}/Library/LaunchAgents" "${HOME}/Library/Logs/resell"

python3 - "$PLIST_SRC" "$PLIST_DST" "$WRAPPER" <<'PY'
import sys
src, dst, wrapper = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(src).read()
text = text.replace("__RETURNS_SYNC_WRAPPER__", wrapper)
open(dst, "w").write(text)
print(f"wrote {dst}")
PY

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/${LABEL}" 2>/dev/null || true

echo "Installed $LABEL (every 120s → .worktrees/returns-local)"
echo "Logs: ~/Library/Logs/resell/returns-local-sync.log"
echo "Dev:  ./scripts/dev-returns-localhost.sh"
