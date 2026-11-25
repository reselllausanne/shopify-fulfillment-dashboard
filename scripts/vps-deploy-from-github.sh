#!/usr/bin/env bash
# Deterministic VPS deploy from an exact GitHub SHA.
# Run ON the VPS (or via CI SSH). Never git pull into a dirty branch checkout.
#
# Usage:
#   EXPECTED_SHA=<40hex> bash scripts/vps-deploy-from-github.sh
#   bash scripts/vps-deploy-from-github.sh --sha=<40hex>
#   bash scripts/vps-deploy-from-github.sh --sha=<40hex> --dry-run
#   bash scripts/vps-deploy-from-github.sh --validate-config   # CI / local, no SSH
#   bash scripts/vps-deploy-from-github.sh --sha=<40hex> --migrate  # build → migrate → up
#
# Env files (.env) are never written. No reset --hard / clean / volume rm.
# Docker disk GC lives ONLY in scripts/vps-docker-gc.sh (age-filtered images/build cache, never volumes).
set -euo pipefail

REPO="${REPO:-/opt/resell}"
REMOTE="${REMOTE:-origin}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-resell}"
DEPLOY_SERVICE="${DEPLOY_SERVICE:-web}"
# Every compose worker is `build: .` and bakes the code into its own image, so a
# worker that is not rebuilt keeps running old code next to the new web
# (Galaxus feed ran Sep 16 code until Oct 11). Empty = every compose service except web.
DEPLOY_WORKERS="${DEPLOY_WORKERS-${DEPLOY_PRICE_WORKERS-}}"
DEPLOY_ALL_WORKERS="${DEPLOY_ALL_WORKERS:-0}"
EXPECTED_SHA="${EXPECTED_SHA:-}"
DRY_RUN=0
VALIDATE_CONFIG=0
RUN_MIGRATE=0
LOCK_FILE="${DEPLOY_LOCK_FILE:-/var/lock/resell-deploy.lock}"

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
}

# Compose recreate leftovers: <12hexid>_<project>-<service>-<n>
# Live service name is <project>-<service>-<n> without hex prefix — never a match.
is_stale_compose_rename_name() {
  local name="${1:-}"
  local project="${2:-$COMPOSE_PROJECT_NAME}"
  local service="${3:-$DEPLOY_SERVICE}"
  [[ "$name" =~ ^[0-9a-f]+_${project}-${service}-[0-9]+$ ]]
}

# Docker State.Status values safe to remove as recreate leftovers.
is_stopped_container_state() {
  local state
  state="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  case "$state" in
    created | exited | dead) return 0 ;;
    *) return 1 ;;
  esac
}

is_running_like_container_state() {
  local state
  state="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  case "$state" in
    running | restarting | paused | removing) return 0 ;;
    *) return 1 ;;
  esac
}

# Decide action for one candidate. Pure — used by cleanup + tests.
# Args: name state labelled_project labelled_service [project] [service]
# Prints: skip_live | skip_unrelated | skip_not_rename | skip_other_state | remove | abort_running
classify_stale_rename_candidate() {
  local name="${1:-}"
  local state="${2:-}"
  local labelled_project="${3:-}"
  local labelled_service="${4:-}"
  local project="${5:-$COMPOSE_PROJECT_NAME}"
  local service="${6:-$DEPLOY_SERVICE}"
  local live_name="${project}-${service}-1"

  if [ "$name" = "$live_name" ] || [[ "$name" =~ ^${project}-${service}-[0-9]+$ ]]; then
    echo "skip_live"
    return 0
  fi

  if [ "$labelled_project" != "$project" ] || [ "$labelled_service" != "$service" ]; then
    echo "skip_unrelated"
    return 0
  fi

  if ! is_stale_compose_rename_name "$name" "$project" "$service"; then
    echo "skip_not_rename"
    return 0
  fi

  if is_running_like_container_state "$state"; then
    echo "abort_running"
    return 0
  fi

  if is_stopped_container_state "$state"; then
    echo "remove"
    return 0
  fi

  echo "skip_other_state"
}

# True if $1 is an ancestor of $2 (includes equality). Rejects feature-only commits.
is_sha_ancestor_of_ref() {
  local want="${1:-}"
  local ref="${2:-}"
  git merge-base --is-ancestor "$want" "$ref"
}

assert_sha_allowed_on_main() {
  local want="${1:-}"
  local main_ref="${REMOTE}/main"
  if ! git rev-parse --verify "$main_ref" >/dev/null 2>&1; then
    echo "FATAL: missing $main_ref after fetch"
    exit 11
  fi
  if ! is_sha_ancestor_of_ref "$want" "$main_ref"; then
    echo "FATAL: SHA $want is not an ancestor of $main_ref (feature-branch-only commits rejected; rollback must use a prior main commit)"
    exit 13
  fi
  echo "== SHA $want is ancestor of $main_ref (allowed)"
}

# Plan cleanup from tabular candidates (name|state|labelled_project|labelled_service|id).
# Prints either:
#   ABORT <desc>
#   REMOVE <id>  (zero or more)
# Used by tests to prove abort ⇒ no REMOVE lines.
plan_stale_rename_cleanup() {
  local project="${1:-$COMPOSE_PROJECT_NAME}"
  local service="${2:-$DEPLOY_SERVICE}"
  shift 2 || true
  local line name state lp ls id action
  local abort=0
  local abort_desc=""
  local removes=()
  for line in "$@"; do
    IFS='|' read -r name state lp ls id <<<"$line"
    action="$(classify_stale_rename_candidate "$name" "$state" "$lp" "$ls" "$project" "$service")"
    case "$action" in
      abort_running)
        abort=1
        abort_desc="$name"
        ;;
      remove)
        removes+=("$id")
        ;;
    esac
  done
  if [ "$abort" = "1" ]; then
    echo "ABORT $abort_desc"
    return 0
  fi
  local rid
  for rid in "${removes[@]+"${removes[@]}"}"; do
    echo "REMOVE $rid"
  done
}

# Remove only stopped, labelled, renamed leftovers for this project/service.
# If a matching rename leftover is running → fail closed, remove nothing.
cleanup_stale_web_rename_containers() {
  local project="$COMPOSE_PROJECT_NAME"
  local service="$DEPLOY_SERVICE"
  local id name state labelled_project labelled_service action
  local to_remove=()
  local saw_running_stale=0
  local running_stale_desc=""

  if ! command -v docker >/dev/null 2>&1; then
    echo "== cleanup skipped (no docker)"
    return 0
  fi

  while IFS= read -r id; do
    [ -n "${id:-}" ] || continue
    name="$(docker inspect -f '{{.Name}}' "$id" 2>/dev/null | sed 's#^/##')" || continue
    state="$(docker inspect -f '{{.State.Status}}' "$id" 2>/dev/null || true)"
    labelled_project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$id" 2>/dev/null || true)"
    labelled_service="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$id" 2>/dev/null || true)"
    action="$(classify_stale_rename_candidate "$name" "$state" "$labelled_project" "$labelled_service" "$project" "$service")"
    case "$action" in
      remove)
        echo "== stale labelled rename leftover (stopped): $name ($id) state=$state"
        to_remove+=("$id")
        ;;
      abort_running)
        saw_running_stale=1
        running_stale_desc="$name ($id) state=$state"
        echo "== STALE_RENAMED_CONTAINER_RUNNING: $running_stale_desc"
        ;;
      skip_live | skip_unrelated | skip_not_rename | skip_other_state) ;;
      *)
        echo "== cleanup unknown action=$action for $name"
        ;;
    esac
  done < <(
    # -a required: stopped recreate leftovers (exited/created/dead) are the target.
    # Without -a, only running containers appear and stopped renames are never cleaned.
    docker ps -aq --all \
      --filter "label=com.docker.compose.project=${project}" \
      --filter "label=com.docker.compose.service=${service}" \
      2>/dev/null || true
  )

  if [ "$saw_running_stale" = "1" ]; then
    echo "FATAL: STALE_RENAMED_CONTAINER_RUNNING — refusing to stop/remove; resolve manually: $running_stale_desc"
    exit 14
  fi

  local rid
  for rid in "${to_remove[@]+"${to_remove[@]}"}"; do
    if [ "$DRY_RUN" = "1" ]; then
      echo "   (dry-run) would: docker rm $rid"
    else
      # No -f: only stopped containers reach here.
      docker rm "$rid"
    fi
  done
}

validate_deploy_config() {
  local root="${1:-.}"
  echo "== validate-config root=$root"
  test -f "$root/Dockerfile" || {
    echo "FATAL: missing Dockerfile"
    exit 20
  }
  test -f "$root/docker-compose.yml" || {
    echo "FATAL: missing docker-compose.yml"
    exit 20
  }
  grep -qE '^FROM ' "$root/Dockerfile" || {
    echo "FATAL: Dockerfile missing FROM"
    exit 20
  }
  grep -qE '^[[:space:]]*web:' "$root/docker-compose.yml" || {
    echo "FATAL: docker-compose.yml missing web service"
    exit 20
  }
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    # compose.yml references env_file: .env — CI checkouts have no secrets file.
    # Touch an empty placeholder for `compose config` only; never write real secrets.
    local created_env=0
    if [ ! -f "$root/.env" ]; then
      : >"$root/.env"
      created_env=1
    fi
    if ! docker compose --project-directory "$root" -f "$root/docker-compose.yml" config >/dev/null; then
      [ "$created_env" = "1" ] && rm -f "$root/.env"
      echo "FATAL: docker compose config failed"
      exit 21
    fi
    [ "$created_env" = "1" ] && rm -f "$root/.env"
    echo "VALIDATE_CONFIG_OK (docker compose config)"
    return 0
  fi
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "FATAL: docker compose required in GitHub Actions validate job"
    exit 21
  fi
  echo "VALIDATE_CONFIG_OK (file checks only; install docker for full compose config)"
}

acquire_lock() {
  local dir
  local wait_secs="${DEPLOY_LOCK_WAIT_SECS:-900}"
  dir="$(dirname "$LOCK_FILE")"
  mkdir -p "$dir" 2>/dev/null || LOCK_FILE="/tmp/resell-deploy.lock"
  exec 9>"$LOCK_FILE"
  # Wait for prior deploy (incl. CI overlap after a timed-out SSH session) instead of
  # instant refuse — overlapping main pushes used to fail the newer SHA with exit 12.
  if ! flock -w "$wait_secs" 9; then
    echo "FATAL: another deploy still holds $LOCK_FILE after ${wait_secs}s wait"
    exit 12
  fi
  echo "== lock $LOCK_FILE (waited up to ${wait_secs}s)"
}

# ---------------------------------------------------------------------------
# Timing + prebuilt image (built by .github/workflows/build-image.yml, pushed to ghcr).
# Prebuilt image = no `next build` on the VPS. Any failure => old behaviour (compose build).
# ---------------------------------------------------------------------------
DEPLOY_T0="$SECONDS"
tstep() {
  echo "== [T+$((SECONDS - DEPLOY_T0))s] $*"
}

PREBUILT_IMAGE=""
PREBUILT_IMAGE_REPO="${PREBUILT_IMAGE_REPO:-}"
PREBUILT_WAIT_SECS="${PREBUILT_WAIT_SECS:-900}"

# Pull ghcr.io/<repo>:sha-<want>. Waits for the parallel build-image run. Never fatal.
fetch_prebuilt_image() {
  local want="$1" tag deadline
  [ -n "$PREBUILT_IMAGE_REPO" ] || { tstep "prebuilt: PREBUILT_IMAGE_REPO unset -> local build"; return 0; }
  tag="${PREBUILT_IMAGE_REPO}:sha-${want}"
  if [ -n "${GHCR_TOKEN:-}" ] && [ -n "${GHCR_USER:-}" ]; then
    printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null 2>&1 \
      || { tstep "prebuilt: ghcr login failed -> local build"; return 0; }
  fi
  deadline=$((SECONDS + PREBUILT_WAIT_SECS))
  while :; do
    if docker pull "$tag" >/dev/null 2>&1; then
      PREBUILT_IMAGE="$tag"
      tstep "prebuilt: pulled $tag"
      break
    fi
    if (( SECONDS >= deadline )); then
      tstep "prebuilt: $tag not available after ${PREBUILT_WAIT_SECS}s -> local build"
      break
    fi
    sleep 5
  done
  docker logout ghcr.io >/dev/null 2>&1 || true
  return 0
}

# Make <project>-<svc>:latest current: tag the prebuilt image, or build locally.
ensure_image() {
  local svc="$1"
  if [ -n "$PREBUILT_IMAGE" ]; then
    docker tag "$PREBUILT_IMAGE" "${COMPOSE_PROJECT_NAME}-${svc}:latest"
    tstep "image $svc <- prebuilt"
  else
    docker compose build "$svc"
    tstep "image $svc built locally"
  fi
}

# After up: web must be running, labelled for this project/service, image matches built service image when available.
verify_web_deployment() {
  local want_sha="${1:-}"
  local cid state project_label service_label image_id expected_image_id

  cid="$(docker compose ps -q "$DEPLOY_SERVICE" 2>/dev/null | head -1 || true)"
  if [ -z "$cid" ]; then
    echo "FATAL: POST_DEPLOY_VERIFY — no container for service $DEPLOY_SERVICE"
    exit 15
  fi

  state="$(docker inspect -f '{{.State.Status}}' "$cid")"
  if [ "$state" != "running" ]; then
    echo "FATAL: POST_DEPLOY_VERIFY — $DEPLOY_SERVICE state=$state (want running)"
    docker compose ps "$DEPLOY_SERVICE" || true
    exit 15
  fi

  project_label="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$cid")"
  service_label="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$cid")"
  if [ "$project_label" != "$COMPOSE_PROJECT_NAME" ] || [ "$service_label" != "$DEPLOY_SERVICE" ]; then
    echo "FATAL: POST_DEPLOY_VERIFY — labels project=$project_label service=$service_label (want $COMPOSE_PROJECT_NAME/$DEPLOY_SERVICE)"
    exit 15
  fi

  image_id="$(docker inspect -f '{{.Image}}' "$cid")"
  expected_image_id="$(docker images -q "${COMPOSE_PROJECT_NAME}-${DEPLOY_SERVICE}:latest" 2>/dev/null | head -1 || true)"
  if [ -z "$expected_image_id" ]; then
    expected_image_id="$(docker images -q "${COMPOSE_PROJECT_NAME}-${DEPLOY_SERVICE}" 2>/dev/null | head -1 || true)"
  fi
  if [ -n "$expected_image_id" ]; then
    # Compare truncated IDs (inspect may return sha256:…).
    local img_short exp_short
    img_short="$(printf '%s' "$image_id" | sed 's#^sha256:##')"
    exp_short="$(printf '%s' "$expected_image_id" | sed 's#^sha256:##')"
    if [[ "$img_short" != "$exp_short"* && "$exp_short" != "$img_short"* ]]; then
      echo "FATAL: POST_DEPLOY_VERIFY — running image $image_id != built ${COMPOSE_PROJECT_NAME}-${DEPLOY_SERVICE} ($expected_image_id)"
      exit 15
    fi
    echo "== POST_DEPLOY_VERIFY image ok $image_id"
  else
    echo "== POST_DEPLOY_VERIFY image tag not found locally — skipped image match (labels+running ok)"
  fi

  echo "== POST_DEPLOY_VERIFY ok service=$DEPLOY_SERVICE cid=$cid sha=$want_sha"
}

# Critical workers that must be *running* after deploy (not merely Created/Exited).
# A Created-but-never-started feed worker silently kills stock/price for days.
# Override: DEPLOY_CRITICAL_WORKERS="worker-galaxus-feed worker-ops-background"
DEPLOY_CRITICAL_WORKERS="${DEPLOY_CRITICAL_WORKERS:-worker-galaxus-feed}"

# Wait until compose service is running. If stuck in created/exited, force start.
# Exit 17 on timeout — deploy must not report DEPLOY_OK with a dead feed worker.
verify_compose_service_running() {
  local svc="$1"
  local timeout_sec="${2:-90}"
  local deadline=$((SECONDS + timeout_sec))
  local cid state

  echo "== verify running: $svc (timeout ${timeout_sec}s)"
  while (( SECONDS < deadline )); do
    cid="$(docker compose ps -aq "$svc" 2>/dev/null | head -1 || true)"
    if [ -z "$cid" ]; then
      echo "== $svc: no container — compose up -d --no-deps"
      docker compose up -d --no-deps "$svc" || true
      sleep 2
      continue
    fi
    state="$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || echo missing)"
    if [ "$state" = "running" ]; then
      echo "== POST_DEPLOY_VERIFY worker ok $svc cid=$cid"
      return 0
    fi
    echo "== $svc state=$state — forcing start"
    # Created/exited: compose up alone sometimes no-ops; docker start recovers Created.
    docker start "$cid" 2>/dev/null || true
    docker compose up -d --no-deps "$svc" || true
    sleep 3
  done

  echo "FATAL: POST_DEPLOY_VERIFY — $svc not running after ${timeout_sec}s (feeds will stall)"
  docker compose ps -a "$svc" || true
  docker inspect -f 'Status={{.State.Status}} Error={{.State.Error}} Exit={{.State.ExitCode}} OOM={{.State.OOMKilled}}' \
    "$(docker compose ps -aq "$svc" 2>/dev/null | head -1)" 2>/dev/null || true
  exit 17
}

verify_critical_workers_running() {
  local svc
  for svc in $DEPLOY_CRITICAL_WORKERS; do
    [ -n "$svc" ] || continue
    verify_compose_service_running "$svc" 90
  done
}

DEPLOY_FEED_WORKER="${DEPLOY_FEED_WORKER:-worker-galaxus-feed}"

# The feed worker drains its in-flight build on SIGTERM (up to ~25 min), so recreating it
# blocks the deploy for that long. Put it LAST so every other service gets the new code in
# ~2 min instead of waiting behind the drain.
order_workers_feed_last() {
  local w out="" has_feed=0
  for w in "$@"; do
    [ -n "$w" ] || continue
    if [ "$w" = "$DEPLOY_FEED_WORKER" ]; then
      has_feed=1
    else
      out="$out $w"
    fi
  done
  if [ "$has_feed" = "1" ]; then
    out="$out $DEPLOY_FEED_WORKER"
  fi
  # shellcheck disable=SC2086
  echo $out
}

resolve_deploy_workers() {
  if [ -n "$DEPLOY_WORKERS" ]; then
    # shellcheck disable=SC2086
    order_workers_feed_last $DEPLOY_WORKERS
    return 0
  fi
  # shellcheck disable=SC2046
  order_workers_feed_last $(docker compose config --services | grep -vx "$DEPLOY_SERVICE")
}

# ---------------------------------------------------------------------------
# Selective worker redeploy.
# Workers bake the whole repo into their image, but each only *runs* the files in its import
# closure. Recreating all of them on every merge killed in-flight feed/AWB runs and added
# 1-5 min (feed drain). Now: redeploy a worker only if a changed file is in its closure, or a
# global input (deps, prisma, Dockerfile, compose, scripts, data/config files) changed.
# Anything unknown / any error => redeploy ALL (old behaviour). Force all: DEPLOY_ALL_WORKERS=1.
# Marker = last SHA at which ALL worker images were known current (stored in .git, untracked).
# ---------------------------------------------------------------------------
worker_marker_file() {
  echo "$(git rev-parse --git-dir)/deploy-workers-sha"
}

# 0 = this changed file affects every worker (or cannot be proven irrelevant).
is_global_worker_input() {
  local f="${1:-}"
  case "$f" in
    # never reach any container
    docs/* | .cursor/* | .github/* | *.md | *.test.ts | *.test.tsx | *.spec.ts | */__tests__/* | public/*) return 1 ;;
    scripts/vps-* | scripts/safe-* | scripts/*.test.sh) return 1 ;;
    package.json | package-lock.json | Dockerfile | docker-compose.yml | docker-entrypoint.sh) return 0 ;;
    tsconfig.json | prisma/* | portable_product_upsert/* | scripts/workers/stubServerOnly.cjs) return 0 ;;
    scripts/*) return 0 ;;
  esac
  case "$f" in
    # code files: decided by import closure
    *.ts | *.tsx | *.mts | *.js | *.mjs | *.cjs | *.css) return 1 ;;
  esac
  # json/sql/py/xml/... may be read at runtime by a worker: be conservative
  return 0
}

# stdin: changed files. $1: closure file ("service<TAB>file" lines). $2..: candidate services.
# Prints services to redeploy (one per line); prints "ALL" if a global input changed.
plan_worker_redeploy() {
  local closure="$1"
  shift
  local changed=() f
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if is_global_worker_input "$f"; then
      echo "ALL"
      return 0
    fi
    changed+=("$f")
  done
  local svc
  for svc in "$@"; do
    for f in "${changed[@]+"${changed[@]}"}"; do
      if grep -qxF "${svc}	${f}" "$closure"; then
        echo "$svc"
        break
      fi
    done
  done
}

# service<TAB>entry.ts for every compose service with `build:` and a scripts/*.ts command.
compose_worker_entries() {
  awk '
    /^  [a-zA-Z0-9_-]+:[[:space:]]*$/ { svc=$1; sub(":","",svc); next }
    /^    build:/ { built[svc]=1 }
    /^    command:/ { if (match($0, /scripts\/[^"]*\.ts/)) entry[svc]=substr($0, RSTART, RLENGTH) }
    END { for (s in entry) if (built[s]) print s "\t" entry[s] }
  ' "${1:-docker-compose.yml}" | sort
}

# Prints the worker services to redeploy for WANT, space separated. "ALL" => full old path.
select_workers_for_deploy() {
  local want="$1" marker base entries closure svc plan
  if [ "${DEPLOY_ALL_WORKERS:-0}" = "1" ] || [ -n "$DEPLOY_WORKERS" ]; then
    echo "ALL"; return 0
  fi
  marker="$(worker_marker_file)"
  if [ ! -f "$marker" ]; then
    echo "== workers: no marker -> ALL" >&2; echo "ALL"; return 0
  fi
  base="$(cat "$marker")"
  if ! git cat-file -e "${base}^{commit}" 2>/dev/null || ! git merge-base --is-ancestor "$base" "$want" 2>/dev/null; then
    echo "== workers: marker $base unusable -> ALL" >&2; echo "ALL"; return 0
  fi
  if git diff --quiet "$base" "$want" --; then
    echo "== workers: no diff since $base -> none" >&2; return 0
  fi
  entries="$(compose_worker_entries docker-compose.yml)"
  if [ -z "$entries" ]; then
    echo "== workers: no entries parsed -> ALL" >&2; echo "ALL"; return 0
  fi
  closure="$(mktemp)"
  # shellcheck disable=SC2086
  if ! docker run --rm --entrypoint node -w /app "${COMPOSE_PROJECT_NAME}-${DEPLOY_SERVICE}:latest" \
      scripts/vps-worker-closure.mjs $(echo "$entries" | cut -f2 | sort -u | tr '\n' ' ') >"$closure.raw" 2>/dev/null; then
    echo "== workers: closure failed -> ALL" >&2; rm -f "$closure" "$closure.raw"; echo "ALL"; return 0
  fi
  # entry -> service rows
  while IFS="	" read -r svc entry; do
    awk -F'\t' -v e="$entry" -v s="$svc" '$1==e {print s "\t" $2}' "$closure.raw"
  done <<<"$entries" >"$closure"
  if [ ! -s "$closure" ]; then
    echo "== workers: empty closure -> ALL" >&2; rm -f "$closure" "$closure.raw"; echo "ALL"; return 0
  fi
  plan="$(git diff --name-only "$base" "$want" -- | plan_worker_redeploy "$closure" $(echo "$entries" | cut -f1) || true)"
  rm -f "$closure" "$closure.raw"
  if printf '%s\n' "$plan" | grep -qx ALL; then
    echo "ALL"; return 0
  fi
  order_workers_feed_last $plan
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --sha=*)
        EXPECTED_SHA="${1#--sha=}"
        ;;
      --sha)
        EXPECTED_SHA="${2:-}"
        shift
        ;;
      --dry-run)
        DRY_RUN=1
        ;;
      --validate-config)
        VALIDATE_CONFIG=1
        ;;
      --migrate)
        RUN_MIGRATE=1
        ;;
      --all-workers)
        DEPLOY_ALL_WORKERS=1
        ;;
      --service=*)
        DEPLOY_SERVICE="${1#--service=}"
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        echo "FATAL: unknown arg: $1"
        usage
        exit 2
        ;;
    esac
    shift
  done
}

main() {
  parse_args "$@"

  if [ "$VALIDATE_CONFIG" = "1" ]; then
    validate_deploy_config "$(pwd)"
    exit 0
  fi

  if [ -z "$EXPECTED_SHA" ]; then
    echo "FATAL: EXPECTED_SHA or --sha= required (exact GitHub commit). Refusing ambiguous origin/main deploy."
    exit 2
  fi

  if ! [[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    echo "FATAL: EXPECTED_SHA must be full 40-char hex, got: $EXPECTED_SHA"
    exit 2
  fi

  cd "$REPO"
  export COMPOSE_PROJECT_NAME

  echo "== $(hostname) $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "== repo $REPO project=$COMPOSE_PROJECT_NAME service=$DEPLOY_SERVICE dry_run=$DRY_RUN migrate=$RUN_MIGRATE"
  echo "== REQUESTED_SHA $EXPECTED_SHA"

  if [ "$DRY_RUN" != "1" ]; then
    acquire_lock
  fi

  git fetch "$REMOTE" --prune

  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "FATAL: tracked files dirty on VPS — refusing deploy (no pull/reset)"
    git status -sb
    exit 10
  fi

  if ! git cat-file -e "${EXPECTED_SHA}^{commit}" 2>/dev/null; then
    echo "FATAL: SHA $EXPECTED_SHA not present after fetch"
    exit 11
  fi

  WANT="$(git rev-parse --verify "${EXPECTED_SHA}^{commit}")"
  assert_sha_allowed_on_main "$WANT"

  PRE_HEAD="$(git rev-parse HEAD)"
  PRE_TAG="pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short "$PRE_HEAD")"

  echo "== pre-HEAD $PRE_HEAD"
  echo "== safety tag $PRE_TAG (rollback: EXPECTED_SHA=<prior-main-sha> bash scripts/vps-deploy-from-github.sh)"

  # After SSH rescue / overlapping CI: already on target SHA with healthy web → no rebuild.
  # Avoids another 30–60m next build when a prior Deploy VPS timed out but rescue landed the SHA.
  if [ "$DRY_RUN" != "1" ] && [ "$PRE_HEAD" = "$WANT" ]; then
    echo "== HEAD already REQUESTED_SHA — try skip-rebuild if web healthy"
    if (verify_web_deployment "$WANT"); then
      echo "DEPLOY_OK skipped_rebuild sha=$WANT (already live)"
      exit 0
    fi
    echo "== verify failed at current HEAD — continuing full rebuild"
  fi

  if [ "$DRY_RUN" = "1" ]; then
    echo "== dry-run plan:"
    echo "   git checkout --detach $WANT"
    echo "   cleanup stopped labelled rename leftovers only (abort if running stale)"
    echo "   docker compose build $DEPLOY_SERVICE"
    if [ "$RUN_MIGRATE" = "1" ]; then
      echo "   docker compose run --rm --no-deps $DEPLOY_SERVICE npx prisma migrate deploy"
      echo "   docker compose up -d --no-deps $DEPLOY_SERVICE"
    else
      echo "   migrations: SKIPPED"
      echo "   docker compose up -d --no-deps $DEPLOY_SERVICE"
    fi
    echo "   verify web running + labels (+ image when available)"
    echo "   workers: selective by import closure vs marker (ALL when unsure)"
    for svc in $(resolve_deploy_workers); do
      echo "   (if selected) docker compose build $svc && docker compose up -d --no-deps $svc"
      echo "   verify_compose_service_running $svc"
    done
    echo "   verify_critical_workers_running ($DEPLOY_CRITICAL_WORKERS)"
    validate_deploy_config "$REPO"
    cleanup_stale_web_rename_containers
    echo "DRY_RUN_OK requested=$WANT pre_head=$PRE_HEAD"
    exit 0
  fi

  git tag -f "$PRE_TAG" "$PRE_HEAD" || true

  echo "== checkout detach $(git rev-parse --short "$WANT")"
  git checkout --detach "$WANT"

  validate_deploy_config "$REPO"
  cleanup_stale_web_rename_containers

  tstep "start (checkout done)"
  fetch_prebuilt_image "$WANT"
  echo "== build $DEPLOY_SERVICE"
  ensure_image "$DEPLOY_SERVICE"

  if [ "$RUN_MIGRATE" = "1" ]; then
    # Migrate with newly built image BEFORE replacing the running app.
    echo "== migrate deploy (explicit) via compose run — before up"
    docker compose run --rm --no-deps "$DEPLOY_SERVICE" npx prisma migrate deploy
    echo "MIGRATE_OK"
  else
    echo "== migrations: SKIPPED (explicit --migrate required; not run by default)"
  fi

  echo "== up -d --no-deps $DEPLOY_SERVICE"
  docker compose up -d --no-deps "$DEPLOY_SERVICE"

  HEAD_NOW="$(git rev-parse HEAD)"
  echo "== RUNNING_SHA $HEAD_NOW"
  if [ "$HEAD_NOW" != "$WANT" ]; then
    echo "FATAL: RUNNING_SHA $HEAD_NOW != REQUESTED_SHA $WANT"
    exit 11
  fi

  verify_web_deployment "$WANT"
  tstep "web live"

  local workers sel
  sel="$(select_workers_for_deploy "$WANT")"
  if [ "$sel" = "ALL" ]; then
    workers="$(resolve_deploy_workers)"
    echo "== workers: ALL -> $workers"
  else
    workers="$sel"
    echo "== workers: selective -> ${workers:-<none, code unchanged for workers>}"
  fi
  for svc in $workers; do
    echo "== build + up worker $svc"
    if ! ensure_image "$svc" || ! docker compose up -d --no-deps "$svc"; then
      echo "FATAL: worker $svc not redeployed (web is live on $WANT)"
      exit 16
    fi
    # Every worker must leave Created — especially worker-galaxus-feed (stock/price).
    verify_compose_service_running "$svc" 90
    tstep "worker $svc up"
  done
  # sav-agent runs sav-agent/server.mjs (not scripts/*.ts) so worker selection never sees it.
  # Always rebuild: docker layer cache makes it cheap; `up -d` only recreates on image change.
  if docker compose config --services | grep -qx sav-agent; then
    echo "== build + up sav-agent"
    if ! docker compose build sav-agent || ! docker compose up -d --no-deps sav-agent; then
      echo "WARN: sav-agent not redeployed (non-fatal)"
    fi
  fi
  # All worker images now current at WANT (selected ones rebuilt; others unaffected by diff).
  if [ -z "$DEPLOY_WORKERS" ]; then
    echo "$WANT" >"$(worker_marker_file)"
  fi

  echo "== critical workers: $DEPLOY_CRITICAL_WORKERS"
  verify_critical_workers_running

  # Cron Python (SSE consumer / create queue) runs from /opt/shopify-automation;
  # keep it on the same GitHub SHA. Non-fatal: web is already live.
  bash "$REPO/scripts/sync-shopify-automation.sh" || echo "WARN: shopify-automation sync failed"

  # Free old images/build cache (age-filtered, never volumes). Non-fatal; lock still held so
  # no concurrent build races the prune.
  bash "$REPO/scripts/vps-docker-gc.sh" || echo "WARN: docker gc failed (non-fatal)"

  tstep "done"
  echo "DEPLOY_OK requested=$WANT running=$HEAD_NOW pre_tag=$PRE_TAG"
}

# Allow sourcing for tests.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
