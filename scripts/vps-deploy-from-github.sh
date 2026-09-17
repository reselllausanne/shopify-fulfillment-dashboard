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
# Env files (.env) are never written. No reset --hard / clean / prune / volume rm.
set -euo pipefail

REPO="${REPO:-/opt/resell}"
REMOTE="${REMOTE:-origin}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-resell}"
DEPLOY_SERVICE="${DEPLOY_SERVICE:-web}"
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
    docker ps -aq \
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
    docker compose --project-directory "$root" -f "$root/docker-compose.yml" config >/dev/null
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
  dir="$(dirname "$LOCK_FILE")"
  mkdir -p "$dir" 2>/dev/null || LOCK_FILE="/tmp/resell-deploy.lock"
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "FATAL: another deploy holds $LOCK_FILE — refusing concurrent deploy"
    exit 12
  fi
  echo "== lock $LOCK_FILE"
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

  echo "== build $DEPLOY_SERVICE"
  docker compose build "$DEPLOY_SERVICE"

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

  echo "DEPLOY_OK requested=$WANT running=$HEAD_NOW pre_tag=$PRE_TAG"
}

# Allow sourcing for tests.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
