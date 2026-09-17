#!/usr/bin/env bash
# Run ON the VPS (or via SSH). Deploy exact GitHub SHA (default origin/main).
set -euo pipefail

REPO="${REPO:-/opt/resell}"
REMOTE="${REMOTE:-origin}"
EXPECTED_SHA="${EXPECTED_SHA:-}"

cd "$REPO"

echo "== $(hostname) $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "== repo $REPO"

git fetch "$REMOTE" --prune

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "FATAL: tracked files dirty on VPS — refusing deploy"
  git status -sb
  exit 10
fi

if [ -n "$EXPECTED_SHA" ]; then
  WANT="$(git rev-parse --verify "${EXPECTED_SHA}^{commit}")"
else
  WANT="$(git rev-parse --verify "${REMOTE}/main^{commit}")"
fi

PRE_TAG="pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)"
git tag -f "$PRE_TAG" HEAD || true
echo "== safety tag $PRE_TAG (rollback: git checkout --detach $PRE_TAG && docker compose build web && docker compose up -d)"

echo "== checkout detach $(git rev-parse --short "$WANT")"
git checkout --detach "$WANT"

echo "== build + up"
docker compose build web
docker compose up -d

HEAD_NOW="$(git rev-parse HEAD)"
echo "== HEAD $HEAD_NOW"
if [ "$HEAD_NOW" != "$WANT" ]; then
  echo "FATAL: HEAD $HEAD_NOW != want $WANT"
  exit 11
fi

echo "DEPLOY_OK $HEAD_NOW"
