# Agent instructions

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
3. Timezone for "last night" business logic: **Europe/Zurich** (`TZ` is exported by the Cloud Agent start script)

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

### Dev server

Cloud Agent `start` runs `npm run dev` on port 3000 with `TZ=Europe/Zurich`.

`DATABASE_URL` is the shared Supabase database. Do not run `prisma migrate` from a cloud agent.

Start defaults `SCRAPER_RECOVER_ORPHANS_ON_STARTUP=0` and `SCRAPER_AUTO_RESUME_ON_STARTUP=0` so boot does not mark scrape runs interrupted or restart them. Set either to `1` only when a scrape resume is intended.

`npm run lint` calls `next lint`. Next.js 16 treats that as a project directory named `lint`, so the script exits 1. Use `npm test` (vitest). Some tests already fail on `main` and are not an environment failure.
