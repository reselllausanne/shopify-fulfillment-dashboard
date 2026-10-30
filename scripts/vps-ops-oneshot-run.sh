#!/usr/bin/env bash
# Long ops jobs that must SURVIVE deploys of the main `resell` compose project.
#
# Why: `docker compose build/up worker-ops-background` SIGKILLs one-offs labelled
# with project=resell + that service (2026-10-30 master-specs-snap-rebuild exit 137
# mid-materialize at ~52%). Running via plain `docker run` with project label
# `resell-oneshot` keeps the job off the deploy kill path.
#
# Usage (on VPS, from /opt/resell):
#   bash scripts/vps-ops-oneshot-run.sh master-specs-snap-rebuild \
#     npx tsx scripts/run-master-specs-snapshot-rebuild.ts
set -euo pipefail

NAME="${1:?container name required}"
shift
if [[ $# -lt 1 ]]; then
  echo "usage: $0 <container-name> <command...>" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

REF="${ONESHOT_REF_CONTAINER:-resell-worker-ops-background-1}"
if ! docker inspect "$REF" >/dev/null 2>&1; then
  echo "FATAL: reference container missing: $REF (start worker-ops-background first)" >&2
  exit 3
fi

IMG="$(docker inspect "$REF" --format '{{.Image}}')"
NET="$(docker inspect "$REF" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' | awk '{print $1}')"
ENV_FILE="$(mktemp /tmp/ops-oneshot-env.XXXXXX)"
cleanup() { rm -f "$ENV_FILE"; }
trap cleanup EXIT

# Single-line env only (PEM / multiline keys break --env-file).
docker inspect "$REF" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | awk -F= 'NF<2{next} $1 ~ /[[:space:]]/ {next} $1=="NODE_OPTIONS"{next} {print}' \
  > "$ENV_FILE"

docker rm -f "$NAME" 2>/dev/null || true

# Line-buffer so `docker logs` shows slim-scan / materialize progress promptly.
exec docker run --rm --name "$NAME" \
  --network "$NET" \
  --env-file "$ENV_FILE" \
  -e "NODE_OPTIONS=${OPS_BACKGROUND_NODE_OPTIONS:---max-old-space-size=10240 --expose-gc}" \
  -v "$(pwd)/.data:/app/.data" \
  --label "resell.oneshot=${NAME}" \
  --label "com.docker.compose.project=resell-oneshot" \
  --label "com.docker.compose.service=oneshot-rebuild" \
  --restart=no \
  "$IMG" \
  sh -c "stdbuf -oL -eL $*"
