#!/usr/bin/env bash
# Pull latest feat/returns-customer-exchange when tracked-clean (for returns localhost worktree).
set -euo pipefail

BRANCH="feat/returns-customer-exchange"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WT="$ROOT/.worktrees/returns-local"
if [ -n "${1:-}" ]; then
  TARGET="$1"
elif [ -e "$WT/.git" ]; then
  TARGET="$WT"
elif [ "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")" = "$BRANCH" ]; then
  TARGET="$ROOT"
else
  TARGET="$WT"
fi

if [ ! -d "$TARGET/.git" ] && [ ! -f "$TARGET/.git" ]; then
  echo "missing worktree: $TARGET"
  echo "Run: git worktree add $ROOT/.worktrees/returns-local origin/$BRANCH"
  exit 1
fi

cd "$TARGET"
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "$BRANCH" ]; then
  echo "worktree on $branch, expected $BRANCH — run: git switch $BRANCH"
  exit 1
fi

git fetch origin --prune

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[$BRANCH] tracked dirty — skip pull (commit or stash first)"
  git status -sb
  exit 2
fi

upstream="origin/$BRANCH"
if ! git rev-parse --verify "$upstream" >/dev/null 2>&1; then
  echo "no $upstream yet"
  exit 0
fi

behind="$(git rev-list --count "HEAD..$upstream" 2>/dev/null || echo 0)"
if [ "$behind" = "0" ]; then
  echo "[$BRANCH] already up to date $(git rev-parse --short HEAD)"
  exit 0
fi

echo "[$BRANCH] pulling $behind commit(s)…"
git pull --ff-only origin "$BRANCH"
echo "[$BRANCH] now $(git rev-parse --short HEAD)"
