#!/usr/bin/env bash
# Returns / exchange flow on localhost — always feat/returns-customer-exchange (separate worktree).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WT="$ROOT/.worktrees/returns-local"
BRANCH="feat/returns-customer-exchange"
PORT="${PORT:-3000}"

if [ ! -d "$WT" ]; then
  echo "Creating worktree at $WT …"
  git -C "$ROOT" fetch origin
  git -C "$ROOT" worktree add "$WT" "origin/$BRANCH"
  git -C "$WT" switch "$BRANCH"
fi

"$ROOT/scripts/returns-exchange-auto-sync.sh" "$WT" || true
"$ROOT/scripts/returns-local-link-env.sh"

cd "$WT"
if [ ! -d node_modules ]; then
  echo "Installing dependencies in worktree (once)…"
  npm ci
fi

echo ""
echo "== Returns localhost"
echo "   branch: $BRANCH @ $(git rev-parse --short HEAD)"
echo "   url:    http://localhost:$PORT/returns"
echo "   path:   $WT"
echo "   (Main repo can stay on another branch; auto-sync: install-returns-local-sync-agent.sh)"
echo ""

exec npm run dev -- --port "$PORT"
