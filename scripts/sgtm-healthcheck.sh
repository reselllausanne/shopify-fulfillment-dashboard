#!/usr/bin/env bash
# Server-side GTM health probe (tagging + preview). Exit 0 = healthy or sGTM disabled.
#   bash scripts/sgtm-healthcheck.sh            # local ports (VPS)
#   SGTM_PUBLIC_URL=https://sgtm.resell-lausanne.ch bash scripts/sgtm-healthcheck.sh
set -euo pipefail

TAGGING_PORT="${SGTM_TAGGING_PORT:-8090}"
PREVIEW_PORT="${SGTM_PREVIEW_PORT:-8091}"
PUBLIC_URL="${SGTM_PUBLIC_URL:-}"

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

probe tagging "http://127.0.0.1:${TAGGING_PORT}/healthz"
probe preview "http://127.0.0.1:${PREVIEW_PORT}/healthz"
if [ -n "$PUBLIC_URL" ]; then
  probe public "${PUBLIC_URL%/}/healthz"
fi

exit "$fail"
