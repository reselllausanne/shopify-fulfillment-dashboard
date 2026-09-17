#!/usr/bin/env bash
# LaunchAgent wrapper: safe-sync + macOS notification when blocked or updated.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG_DIR="${HOME}/Library/Logs/resell"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/safe-sync.log"

notify() {
  local title="$1"
  local body="$2"
  /usr/bin/osascript -e "display notification \"${body}\" with title \"${title}\"" 2>/dev/null || true
}

{
  echo "---- $(date '+%Y-%m-%d %H:%M:%S %z') ----"
  set +e
  out="$(bash "$ROOT/scripts/safe-sync.sh" 2>&1)"
  code=$?
  set -e
  printf '%s\n' "$out"
  echo "exit=$code"

  case "$code" in
    0)
      if printf '%s' "$out" | grep -q 'ff-only pull'; then
        head="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
        notify "Resell sync" "Pulled updates → ${head}"
      fi
      ;;
    2)
      notify "Resell sync blocked" "Tracked files dirty — commit/push before pull"
      ;;
    3)
      notify "Resell sync diverged" "Local and GitHub diverged — inspect manually"
      ;;
  esac
  exit "$code"
} >>"$LOG" 2>&1
