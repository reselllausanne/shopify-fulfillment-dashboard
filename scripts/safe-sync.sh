#!/usr/bin/env bash
# Safe laptop sync against GitHub. No auto-commit. No overwrite of dirty work.
set -euo pipefail

remote="${1:-origin}"
branch="$(git rev-parse --abbrev-ref HEAD)"
upstream="$remote/$branch"

echo "== repo: $(git rev-parse --show-toplevel)"
echo "== branch: $branch"
echo "== fetch $remote"
git fetch "$remote" --prune

if ! git rev-parse --verify "$upstream" >/dev/null 2>&1; then
  echo "No upstream $upstream. Push once with: git push -u $remote HEAD"
  git status -sb
  exit 0
fi

lr="$(git rev-list --left-right --count "HEAD...$upstream")"
ahead="${lr%%	*}"
behind="${lr##*	}"
echo "== vs $upstream: ahead=$ahead behind=$behind"

dirty=0
if [ -n "$(git status --porcelain)" ]; then
  dirty=1
  echo "== WORKING TREE DIRTY — will not pull"
  git status -sb
  echo
  echo "Next:"
  echo "  - commit WIP on this branch, or"
  echo "  - git switch -c wip/… && commit && push, or"
  echo "  - stash only if you accept stash risk"
  echo "Then re-run: scripts/safe-sync.sh"
  exit 2
fi

if [ "$behind" = "0" ] && [ "$ahead" = "0" ]; then
  echo "== already in sync with $upstream"
  exit 0
fi

if [ "$behind" != "0" ] && [ "$ahead" = "0" ]; then
  echo "== ff-only pull $upstream"
  git pull --ff-only "$remote" "$branch"
  echo "== HEAD $(git rev-parse --short HEAD)"
  exit 0
fi

if [ "$ahead" != "0" ] && [ "$behind" = "0" ]; then
  echo "== local ahead by $ahead — push when ready: git push $remote HEAD"
  exit 0
fi

echo "== DIVERGED (ahead=$ahead behind=$behind) — no auto rebase/merge"
echo "Inspect: git log --oneline --left-right HEAD...$upstream"
exit 3
