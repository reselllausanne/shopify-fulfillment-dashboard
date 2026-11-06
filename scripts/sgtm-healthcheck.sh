#!/usr/bin/env bash
# Server-side GTM health probe (tagging + preview). Exit 0 = healthy or sGTM disabled.
# On FAIL: force-recreate once, re-probe (containers can stick on 503 for weeks).
#   bash scripts/sgtm-healthcheck.sh            # local ports (VPS)
#   SGTM_PUBLIC_URL=https://sgtm.resell-lausanne.ch bash scripts/sgtm-healthcheck.sh
#   SGTM_AUTOHEAL=0  → probe only (no recreate)
set -euo pipefail

TAGGING_PORT="${SGTM_TAGGING_PORT:-8090}"
PREVIEW_PORT="${SGTM_PREVIEW_PORT:-8091}"
PUBLIC_URL="${SGTM_PUBLIC_URL:-}"
AUTOHEAL="${SGTM_AUTOHEAL:-1}"

if [ -f .env ] && ! grep -qE '^COMPOSE_PROFILES=.*\bsgtm\b' .env; then
  echo "SGTM_DISABLED (COMPOSE_PROFILES lacks sgtm) — nothing to check"
  exit 0
fi

fail=0
probe() {
  local name="$1" url="$2"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" || echo 000)"
  if [ "$code" = "200" ]; then
    echo "OK   $name $url"
  else
    echo "FAIL $name $url http=$code"
    fail=1
  fi
}

run_probes() {
  fail=0
  probe tagging "http://127.0.0.1:${TAGGING_PORT}/healthz"
  probe preview "http://127.0.0.1:${PREVIEW_PORT}/healthz"
  if [ -n "$PUBLIC_URL" ]; then
    probe public "${PUBLIC_URL%/}/healthz"
  fi
}

run_probes

if [ "$fail" -ne 0 ] && [ "$AUTOHEAL" = "1" ]; then
  echo "AUTOHEAL: docker compose up -d --force-recreate sgtm-preview sgtm-tagging"
  docker compose up -d --force-recreate sgtm-preview sgtm-tagging
  # Image needs a few seconds after listen before /healthz flips 503→200
  sleep 8
  run_probes
fi

exit "$fail"
