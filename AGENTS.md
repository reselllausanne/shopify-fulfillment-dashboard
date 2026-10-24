# Agent instructions

## Parallel agents & Macs (read first)

Several Cursor chats (Cloud + local) may edit this repo at once. **Coordinate only via GitHub**, not local disk.

1. **Start:** `git fetch origin` → work on the **feature branch for this task** (user or chat must name it). Example: customer `/returns` exchange → `feat/returns-customer-exchange`. If none exists: `git switch -c feat/<topic> origin/main`.
2. **During:** One topic per branch. Do not mix unrelated files. Untracked files need `git add` + commit (or `git stash push -u`); plain stash drops untracked.
3. **Before switching branch or ending:** commit on that branch → `git push -u origin HEAD`. Unpushed work is invisible to other agents/Macs.
4. **Never** `git switch` with tracked dirty files on the wrong topic; never `switch -C` a feature branch onto `main` without explicit user OK.
5. **Helpers:** `./scripts/safe-sync.sh`, `./scripts/safe-push.sh`; returns WIP → `./scripts/returns-exchange-guard.sh` and `.cursor/rules/returns-customer-exchange.mdc`.
6. Full playbook: [`docs/PARALLEL-AGENTS.md`](docs/PARALLEL-AGENTS.md).

**Default user prompt for parallel work:** state **topic + branch**; ask agents to stay on that branch and push before stopping.

## GitHub source of truth (mandatory)

- **GitHub `main`** is the only shared source of truth for both Macs and the VPS.
- Every change: feature branch → commit → push → PR/merge to `main` → **auto deploy** (Actions).
- When the user asks to **change and merge** (or ship / put on prod): merge to `main`, then **verify Deploy VPS succeeded** and report VPS SHA. Do not wait for a separate “deploy VPS” ask.
- **Never** hotfix on the VPS (`/opt/resell` is deploy-only).
- **Never** `git pull` over tracked dirty files; use `scripts/safe-sync.sh` / `scripts/safe-push.sh`.
- **Never** force-push, `reset --hard`, or `clean` unless the user explicitly orders it.
- Sync/deploy docs: [`docs/GITHUB-VPS-SYNC.md`](docs/GITHUB-VPS-SYNC.md).
- VPS deploy on push to `main`: [`.github/workflows/deploy-vps.yml`](.github/workflows/deploy-vps.yml).

## Cursor Cloud specific instructions

Cloud Agents run on a remote VM, not your Mac. They do **not** inherit Mac MCP OAuth or local `.env`.

### Before investigating production issues

1. Confirm secrets exist: `npx tsx scripts/cloud-agent-preflight.ts`
2. Use Supabase MCP (`execute_sql`) or Prisma with `DATABASE_URL` for DB queries
3. Timezone for "last night" business logic: **Europe/Zurich** (`TZ` is set in `.cursor/environment.json`)

### Database access

- Primary: `DATABASE_URL` / `DIRECT_URL` (Postgres via Prisma)
- Supabase MCP: OAuth must be connected at [cursor.com/agents](https://cursor.com/agents) → MCP → Supabase
- Useful tables for pricing/stock incidents:
  - `ChannelListingState` — last pushed price/stock per channel
  - `SupplierVariant` — DB source of truth for price/stock
  - `InventorySyncRun` — nightly job summaries
  - `GalaxusFeedRun` — feed export runs
  - `ShopifyOrder` — sales counts by day

### VPS (optional)

If `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER` secrets are set:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
printf '%s\n' "$SSH_PRIVATE_KEY" > ~/.ssh/hetzner && chmod 600 ~/.ssh/hetzner
ssh -i ~/.ssh/hetzner -o StrictHostKeyChecking=accept-new "$SSH_USER@$SSH_HOST"
```

VPS repo path: `/opt/resell`. Logs: `docker compose logs --since 24h`.

### Full setup checklist

See `.cursor/CLOUD_AGENT_SETUP.md` in this repo.
