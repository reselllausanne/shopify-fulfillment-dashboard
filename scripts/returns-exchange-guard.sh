#!/usr/bin/env bash
# Fail fast if returns exchange work is on the wrong branch or about to be lost.
set -euo pipefail

EXPECTED_BRANCH="feat/returns-customer-exchange"
branch="$(git rev-parse --abbrev-ref HEAD)"
root="$(git rev-parse --show-toplevel)"

echo "== $root"
echo "== branch: $branch (expected for /returns exchange: $EXPECTED_BRANCH)"

if [ "$branch" != "$EXPECTED_BRANCH" ]; then
  echo ""
  echo "WRONG BRANCH for returns exchange work."
  echo "  git switch $EXPECTED_BRANCH"
  echo "  git pull --ff-only   # if clean"
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "== tracked changes present — commit or stash before switching away"
  git status -sb
  exit 2
fi

upstream="origin/$EXPECTED_BRANCH"
if git rev-parse --verify "$upstream" >/dev/null 2>&1; then
  lr="$(git rev-list --left-right --count "HEAD...$upstream")"
  ahead="${lr%%	*}"
  behind="${lr##*	}"
  echo "== vs $upstream: ahead=$ahead behind=$behind"
  if [ "$ahead" != "0" ]; then
    echo "== unpushed commits — run: git push origin $EXPECTED_BRANCH"
    exit 3
  fi
else
  echo "== no origin/$EXPECTED_BRANCH yet — push once: git push -u origin HEAD"
fi

echo "== OK"
