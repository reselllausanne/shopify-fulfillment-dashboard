#!/usr/bin/env bash
# Unit checks for deploy helper (no VPS required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=vps-deploy-from-github.sh
source "$ROOT/scripts/vps-deploy-from-github.sh"

fail=0
pass() { echo "ok - $1"; }
bad() { echo "not ok - $1"; fail=1; }

if is_stale_compose_rename_name "243b948f52f2_resell-web-1"; then pass "stale rename name matches"; else bad "stale rename name matches"; fi
if is_stale_compose_rename_name "319268555fcc_resell-web-1"; then pass "stale rename hex match"; else bad "stale rename hex match"; fi
if is_stale_compose_rename_name "resell-web-1"; then bad "live service name must not match stale pattern"; else pass "live service name is not stale leftover"; fi
if is_stale_compose_rename_name "resell-worker-galaxus-edi-1"; then bad "worker name rejected"; else pass "unrelated name rejected"; fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  if (cd "$ROOT" && bash scripts/vps-deploy-from-github.sh --validate-config); then
    pass "validate-config"
  else
    bad "validate-config"
  fi
else
  echo "skip - docker compose unavailable"
fi

set +e
msg="$(EXPECTED_SHA=abc REPO=/tmp/does-not-exist-resell bash "$ROOT/scripts/vps-deploy-from-github.sh" 2>&1)"
code=$?
set -e
if [ "$code" -ne 0 ]; then pass "short sha rejected"; else bad "short sha rejected"; fi
if [[ "$msg" == *'40-char'* ]]; then pass "short sha message"; else bad "short sha message: $msg"; fi

set +e
msg2="$(bash "$ROOT/scripts/vps-deploy-from-github.sh" 2>&1)"
code2=$?
set -e
if [ "$code2" -ne 0 ] && [[ "$msg2" == *'EXPECTED_SHA'* || "$msg2" == *'--sha='* ]]; then
  pass "missing sha rejected"
else
  bad "missing sha rejected: $msg2"
fi

if [ "$fail" -ne 0 ]; then
  echo "FAIL"
  exit 1
fi
echo "PASS"
