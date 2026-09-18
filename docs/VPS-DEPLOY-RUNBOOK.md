# VPS deploy runbook

GitHub `main` → Actions → exact SHA on `/opt/resell`. No `git pull` into a branch. Env files untouched.

## Root cause (2026-09-17 failures)

Failing step: **Deploy commit on VPS** → `docker compose up -d`.

Exact error:

```text
Container resell-web-1 Error response from daemon: Conflict.
The container name "/243b948f52f2_resell-web-1" is already in use by container "080c827e…".
You have to remove (or rename) that container to be able to reuse that name.
```

Classification: **docker compose recreate / stale container-name conflict** (not git dirty, not secrets, not image build).  
Compose renames the old container to `{oldId}_resell-web-1` during recreate; a leftover from a prior/interrupted/concurrent up blocks the next recreate. Concurrent Actions + manual SSH deploys raced on the same host.

## Normal deploy

Automatic: merge/push to `main` → workflow `Deploy VPS`.

Target SHA must be a full 40-char hex **and** an ancestor of `origin/main` (current tip or prior main for rollback). Feature-branch-only commits are rejected.

Manual (same mechanism):

```bash
ssh resell-vps 'cd /opt/resell && git fetch origin --prune && \
  WANT=$(git rev-parse origin/main) && \
  git show ${WANT}:scripts/vps-deploy-from-github.sh > /tmp/vps-deploy-from-github.sh && \
  chmod +x /tmp/vps-deploy-from-github.sh && \
  EXPECTED_SHA=$WANT bash /tmp/vps-deploy-from-github.sh --sha=$WANT'
```

Workflow dispatch (Actions UI): optional `sha`, `dry_run`, `migrate`.

## Verify

On VPS after deploy logs:

```bash
ssh resell-vps 'cd /opt/resell && git rev-parse HEAD && docker compose ps web'
# Expect: RUNNING_SHA == REQUESTED_SHA in deploy log; SUPPLIER_STOCK_PUBLISH_ENFORCED unset unless intentionally set.
```

## Rollback (same path)

```bash
# Replace PREV with known-good full SHA (e.g. pre-deploy tag target or prior main)
ssh resell-vps 'cd /opt/resell && git fetch origin --prune && \
  PREV=a5fa7f71e06ca4dcf661644d5c8870e29f687bb1 && \
  git show origin/main:scripts/vps-deploy-from-github.sh > /tmp/vps-deploy-from-github.sh && \
  chmod +x /tmp/vps-deploy-from-github.sh && \
  EXPECTED_SHA=$PREV bash /tmp/vps-deploy-from-github.sh --sha=$PREV'
```

Prefer script from `origin/main` when rolling back an old SHA that predates the hardened script.

## Migrations

**Not** run by default. Explicit only. Order is always:

1. `docker compose build web`
2. `docker compose run --rm --no-deps web npx prisma migrate deploy` (new image, app not replaced yet)
3. `docker compose up -d --no-deps web`
4. post-deploy verify (running + compose labels + image match when available)

```bash
# workflow_dispatch migrate=true
# or:
ssh resell-vps '… bash /tmp/vps-deploy-from-github.sh --sha=$WANT --migrate'
```

## Stale container cleanup

Only containers with Compose labels `com.docker.compose.project=<project>` + `service=web` (listed via `docker ps -aq --all` + label filters — never global `docker ps -a` / `docker rm -f`), name matching `^[0-9a-f]+_<project>-web-[0-9]+$`, and state `created|exited|dead` are removed. Live `resell-web-1` is never removed. If a matching rename leftover is **running** → deploy aborts with `STALE_RENAMED_CONTAINER_RUNNING` (nothing removed).

## Dry-run / CI validation

```bash
# Local / CI (no VPS):
bash scripts/vps-deploy-from-github.sh --validate-config
bash scripts/vps-deploy-from-github.test.sh

# On VPS (no build/up):
EXPECTED_SHA=<40hex> bash scripts/vps-deploy-from-github.sh --sha=<40hex> --dry-run
```

## Forbidden

- `git pull` / `reset --hard` / `clean` / `docker system prune` / `docker volume rm` as “fixes”
- Setting `SUPPLIER_STOCK_PUBLISH_ENFORCED=1` unless voluntarily activating publish
- Swallowing deploy errors with `|| true`
