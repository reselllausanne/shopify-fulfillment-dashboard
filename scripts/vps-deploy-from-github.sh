#!/usr/bin/env bash
# Deterministic VPS deploy from an exact GitHub SHA.
# Run ON the VPS (or via CI SSH). Never git pull into a dirty branch checkout.
#
# Usage:
#   EXPECTED_SHA=<40hex> bash scripts/vps-deploy-from-github.sh
#   bash scripts/vps-deploy-from-github.sh --sha=<40hex>
#   bash scripts/vps-deploy-from-github.sh --sha=<40hex> --dry-run
#   bash scripts/vps-deploy-from-github.sh --validate-config   # CI / local, no SSH
#   bash scripts/vps-deploy-from-github.sh --sha=<40hex> --migrate  # explicit migrate deploy only
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

# Compose recreate leftovers look like: <12hexid>_resell-web-1
is_stale_compose_rename_name() {
  local name="${1:-}"
  [[ "$name" =~ ^[0-9a-f]+_resell-web-1$ ]]
}

# Remove stopped/created rename leftovers that block `compose up` recreate.
# Never removes the live service name "resell-web-1". Never touches volumes.
cleanup_stale_web_rename_containers() {
  local id name status
  while read -r id name status; do
    [ -n "${id:-}" ] || continue
    if is_stale_compose_rename_name "$name"; then
      echo "== stale compose rename leftover: $name ($id) status=$status"
      if [ "$DRY_RUN" = "1" ]; then
        echo "   (dry-run) would: docker rm -f $id"
      else
        docker rm -f "$id"
      fi
    fi
  done < <(docker ps -a --format '{{.ID}} {{.Names}} {{.Status}}' 2>/dev/null || true)
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
    # CI / laptop: validate from current checkout, do not require /opt/resell.
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
  echo "== repo $REPO project=$COMPOSE_PROJECT_NAME service=$DEPLOY_SERVICE dry_run=$DRY_RUN"
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
  PRE_HEAD="$(git rev-parse HEAD)"
  PRE_TAG="pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short "$PRE_HEAD")"

  echo "== pre-HEAD $PRE_HEAD"
  echo "== safety tag $PRE_TAG (rollback: EXPECTED_SHA=$PRE_HEAD bash scripts/vps-deploy-from-github.sh)"

  if [ "$DRY_RUN" = "1" ]; then
    echo "== dry-run plan:"
    echo "   git checkout --detach $WANT"
    echo "   cleanup stale *_resell-web-1 rename leftovers"
    echo "   docker compose build $DEPLOY_SERVICE"
    echo "   docker compose up -d --no-deps $DEPLOY_SERVICE"
    if [ "$RUN_MIGRATE" = "1" ]; then
      echo "   docker compose exec -T $DEPLOY_SERVICE npx prisma migrate deploy"
    else
      echo "   migrations: SKIPPED (pass --migrate to run explicitly)"
    fi
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

  echo "== up -d --no-deps $DEPLOY_SERVICE"
  docker compose up -d --no-deps "$DEPLOY_SERVICE"

  HEAD_NOW="$(git rev-parse HEAD)"
  echo "== RUNNING_SHA $HEAD_NOW"
  if [ "$HEAD_NOW" != "$WANT" ]; then
    echo "FATAL: RUNNING_SHA $HEAD_NOW != REQUESTED_SHA $WANT"
    exit 11
  fi

  if [ "$RUN_MIGRATE" = "1" ]; then
    echo "== migrate deploy (explicit)"
    docker compose exec -T "$DEPLOY_SERVICE" npx prisma migrate deploy
    echo "MIGRATE_OK"
  else
    echo "== migrations: SKIPPED (explicit --migrate required; not run by default)"
  fi

  echo "DEPLOY_OK requested=$WANT running=$HEAD_NOW pre_tag=$PRE_TAG"
}

# Allow sourcing for tests.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
