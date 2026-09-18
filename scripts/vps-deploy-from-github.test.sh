#!/usr/bin/env bash
# Unit checks for deploy helper (no VPS / no destructive docker required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=vps-deploy-from-github.sh
source "$ROOT/scripts/vps-deploy-from-github.sh"

fail=0
pass() { echo "ok - $1"; }
bad() { echo "not ok - $1"; fail=1; }

# --- rename pattern ---
if is_stale_compose_rename_name "243b948f52f2_resell-web-1" "resell" "web"; then
  pass "stale rename name matches"
else
  bad "stale rename name matches"
fi
if is_stale_compose_rename_name "resell-web-1" "resell" "web"; then
  bad "a) live resell-web-1 must not match rename pattern"
else
  pass "a) live resell-web-1 never matches rename pattern"
fi

# --- classify: a) live never removed ---
act="$(classify_stale_rename_candidate "resell-web-1" "exited" "resell" "web" "resell" "web")"
if [ "$act" = "skip_live" ]; then pass "a) classify live → skip_live"; else bad "a) classify live → $act"; fi

# --- classify: b) unrelated project never removed ---
act="$(classify_stale_rename_candidate "abc123_other-web-1" "exited" "other" "web" "resell" "web")"
if [ "$act" = "skip_unrelated" ]; then pass "b) unrelated project → skip_unrelated"; else bad "b) unrelated → $act"; fi
act="$(classify_stale_rename_candidate "abc123_resell-web-1" "exited" "otherproj" "web" "resell" "web")"
if [ "$act" = "skip_unrelated" ]; then pass "b) wrong label project → skip_unrelated"; else bad "b) wrong label → $act"; fi

# --- classify: c) stopped labelled renamed leftover → remove ---
act="$(classify_stale_rename_candidate "243b948f52f2_resell-web-1" "exited" "resell" "web" "resell" "web")"
if [ "$act" = "remove" ]; then pass "c) stopped labelled rename → remove"; else bad "c) stopped → $act"; fi
act="$(classify_stale_rename_candidate "319268555fcc_resell-web-1" "created" "resell" "web" "resell" "web")"
if [ "$act" = "remove" ]; then pass "c) created labelled rename → remove"; else bad "c) created → $act"; fi
act="$(classify_stale_rename_candidate "deaddeaddead_resell-web-1" "dead" "resell" "web" "resell" "web")"
if [ "$act" = "remove" ]; then pass "c) dead labelled rename → remove"; else bad "c) dead → $act"; fi
# Listing uses docker ps -aq (all+quiet); no redundant --all.
if grep -qE 'docker ps -aq \\$' "$ROOT/scripts/vps-deploy-from-github.sh" \
  && ! grep -qE 'docker ps -aq --all' "$ROOT/scripts/vps-deploy-from-github.sh"; then
  pass "c) cleanup lists with docker ps -aq (all+quiet)"
else
  bad "c) cleanup must use docker ps -aq (no redundant --all)"
fi

# --- classify: d) running labelled renamed leftover → abort ---
act="$(classify_stale_rename_candidate "080c827ea71b_resell-web-1" "running" "resell" "web" "resell" "web")"
if [ "$act" = "abort_running" ]; then pass "d) running labelled rename → abort_running"; else bad "d) running → $act"; fi

# d) planner: abort ⇒ no REMOVE even if another stopped leftover present
plan="$(plan_stale_rename_cleanup resell web \
  "243b948f52f2_resell-web-1|exited|resell|web|idstop" \
  "080c827ea71b_resell-web-1|running|resell|web|idrun")"
if [[ "$plan" == ABORT* ]] && [[ "$plan" != *REMOVE* ]]; then
  pass "d) abort plan removes nothing"
else
  bad "d) abort plan: $plan"
fi
# c) planner alone removes stopped
plan2="$(plan_stale_rename_cleanup resell web "243b948f52f2_resell-web-1|exited|resell|web|idstop")"
if [[ "$plan2" == "REMOVE idstop" ]]; then pass "c) plan removes stopped leftover"; else bad "c) plan: $plan2"; fi
# a) live never in plan
plan3="$(plan_stale_rename_cleanup resell web "resell-web-1|exited|resell|web|idlive")"
if [ -z "$plan3" ]; then pass "a) live never in remove plan"; else bad "a) live plan: $plan3"; fi
# b) unrelated never in plan
plan4="$(plan_stale_rename_cleanup resell web "abc_other-web-1|exited|other|web|idother")"
if [ -z "$plan4" ]; then pass "b) unrelated never in remove plan"; else bad "b) unrelated plan: $plan4"; fi

# --- SHA ancestor of origin/main ---
if git -C "$ROOT" rev-parse --verify origin/main >/dev/null 2>&1; then
  main_sha="$(git -C "$ROOT" rev-parse origin/main)"
  if (cd "$ROOT" && REMOTE=origin is_sha_ancestor_of_ref "$main_sha" "origin/main"); then
    pass "current origin/main is ancestor of itself"
  else
    bad "current origin/main ancestor check"
  fi
  parent=""
  if git -C "$ROOT" rev-parse --verify "origin/main^" >/dev/null 2>&1 \
    && git -C "$ROOT" cat-file -e "origin/main^^{commit}" 2>/dev/null; then
    parent="$(git -C "$ROOT" rev-parse "origin/main^")"
  fi
  if [ -n "$parent" ]; then
    if (cd "$ROOT" && is_sha_ancestor_of_ref "$parent" "origin/main"); then
      pass "prior main parent is ancestor (rollback OK)"
    else
      bad "prior main parent ancestor"
    fi
  else
    echo "skip - no main^ (shallow clone)"
  fi
  # Feature-only: temp repo outside workspace (avoids sandbox .git/config denials)
  tmp="${TMPDIR:-/tmp}/deploy-sha-ancestor-test-$$"
  rm -rf "$tmp"
  mkdir -p "$tmp"
  export GIT_CONFIG_GLOBAL=/dev/null
  export GIT_CONFIG_SYSTEM=/dev/null
  git -C "$tmp" -c init.defaultBranch=main init -q --template=
  echo x >"$tmp/f"
  git -C "$tmp" -c user.email=test@example.com -c user.name=test add f
  git -C "$tmp" -c user.email=test@example.com -c user.name=test commit -q -m orphan
  orphan="$(git -C "$tmp" rev-parse HEAD)"
  echo y >>"$tmp/f"
  git -C "$tmp" -c user.email=test@example.com -c user.name=test add f
  git -C "$tmp" -c user.email=test@example.com -c user.name=test commit -q -m main2
  main2="$(git -C "$tmp" rev-parse HEAD)"
  git -C "$tmp" checkout -q -b feature
  echo z >>"$tmp/f"
  git -C "$tmp" -c user.email=test@example.com -c user.name=test add f
  git -C "$tmp" -c user.email=test@example.com -c user.name=test commit -q -m feature-only
  feat="$(git -C "$tmp" rev-parse HEAD)"
  # Exercise the same helper used by deploy (is_sha_ancestor_of_ref).
  if (cd "$tmp" && is_sha_ancestor_of_ref "$feat" "$main2") 2>/dev/null; then
    bad "feature-only should not be ancestor of main"
  else
    pass "feature-only commit rejected vs main tip"
  fi
  if (cd "$tmp" && is_sha_ancestor_of_ref "$orphan" "$main2"); then
    pass "root commit still ancestor of main (history OK)"
  else
    bad "root should remain ancestor"
  fi
  if (cd "$tmp" && is_sha_ancestor_of_ref "$main2" "$main2"); then
    pass "main tip is ancestor of itself"
  else
    bad "main tip self-ancestor"
  fi
  rm -rf "$tmp"
else
  echo "skip - origin/main missing (fetch first)"
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  if (cd "$ROOT" && bash scripts/vps-deploy-from-github.sh --validate-config); then
    pass "validate-config"
  else
    bad "validate-config"
  fi
else
  if (cd "$ROOT" && bash scripts/vps-deploy-from-github.sh --validate-config); then
    pass "validate-config (file-only)"
  else
    bad "validate-config"
  fi
fi

set +e
msg="$(EXPECTED_SHA=abc bash "$ROOT/scripts/vps-deploy-from-github.sh" 2>&1)"
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

# --- migrate-before-up order (static) ---
mig_block="$(awk '/if \[ "\$RUN_MIGRATE" = "1" \]/,/^  else$/' "$ROOT/scripts/vps-deploy-from-github.sh" | head -20)"
if echo "$mig_block" | grep -q 'prisma migrate deploy' \
  && awk '
    /docker compose build/ { b=NR }
    /prisma migrate deploy/ { m=NR }
    /docker compose up -d/ { u=NR }
    END { exit !(b && m && u && b < m && m < u) }
  ' "$ROOT/scripts/vps-deploy-from-github.sh"; then
  pass "migrate: build < migrate < up order"
else
  bad "migrate: build < migrate < up order"
fi

# --- post-deploy verify present ---
if grep -q 'verify_web_deployment' "$ROOT/scripts/vps-deploy-from-github.sh" \
  && grep -q 'POST_DEPLOY_VERIFY' "$ROOT/scripts/vps-deploy-from-github.sh"; then
  pass "post-deploy verify_web_deployment present"
else
  bad "post-deploy verify missing"
fi

if [ "$fail" -ne 0 ]; then
  echo "FAIL"
  exit 1
fi
echo "PASS"
