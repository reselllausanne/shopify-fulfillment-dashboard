#!/usr/bin/env bash
# Safe push: only if tracked-clean and ahead of upstream. No force.
set -euo pipefail

remote="${1:-origin}"
branch="$(git rev-parse --abbrev-ref HEAD)"
upstream="$remote/$branch"

echo "== repo: $(git rev-parse --show-toplevel)"
echo "== branch: $branch"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "== TRACKED FILES DIRTY — will not push"
  git status -sb
  exit 2
fi

git fetch "$remote" --prune

if ! git rev-parse --verify "$upstream" >/dev/null 2>&1; then
  echo "== no upstream — first push: git push -u $remote HEAD"
  git push -u "$remote" HEAD
  exit 0
fi

lr="$(git rev-list --left-right --count "HEAD...$upstream")"
ahead="${lr%%	*}"
behind="${lr##*	}"
echo "== vs $upstream: ahead=$ahead behind=$behind"

if [ "$behind" != "0" ]; then
  echo "== behind remote — run scripts/safe-sync.sh first (ff-only pull)"
  exit 3
fi

if [ "$ahead" = "0" ]; then
  echo "== nothing to push"
  exit 0
fi

echo "== pushing $ahead commit(s)"
git push "$remote" HEAD
echo "== HEAD $(git rev-parse --short HEAD)"
