#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${HOME}/Library/Logs/resell/returns-local-sync.log"
mkdir -p "$(dirname "$LOG")"
{
  echo "=== $(date -Iseconds) ==="
  "$ROOT/scripts/returns-exchange-auto-sync.sh" "$ROOT/.worktrees/returns-local" || true
} >>"$LOG" 2>&1
