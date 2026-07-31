# AGENTS.md

## Cursor Cloud specific instructions

This repo is the internal back-office/automation app **`supplier-order-management`** (Next.js 16 App Router + React 19 + Prisma 6 + PostgreSQL, with a small Python bridge in `portable_product_upsert/` and a Python SSE listener in `sse-listener/`). It powers the `resell-lausanne` Shopify store: order matching, fulfillment/scanning, Swiss Post labels, Decathlon (Mirakl) + Galaxus (EDI) integrations, Shopify returns, partner portal, and finance. Standard scripts live in `package.json`; standard config/env docs live in `README.md`. Only the non-obvious, durable caveats are below.

### Services

| Service | Required | How to run | Notes |
|---|---|---|---|
| PostgreSQL 16 | Yes | `sudo pg_ctlcluster 16 main start` | NOT auto-started on boot. DB `fulfillment`, role `dashboard`/`dashboard`, provisioned during env setup. |
| Next.js dev server | Yes | `npm run dev` (port 3000) | Loads `.env` automatically (via `instrumentation.ts`). |
| Background `tsx` workers | No | see `docker-compose.yml` | Not needed to run/test the web UI. |
| Python `portable_product_upsert` / `sse-listener` | No | own `requirements.txt` | Feature-specific; not needed for the dashboard. |

### Env / secrets

- `.env` is git-ignored and already present on the VM (DB URLs + `JWT_SECRET` + `ADMIN_PASSWORD=admin123` / `LOGISTICS_PASSWORD=logistics123`, dev-only values). Login is password-based; `/api/health` and most routes require the `auth_token` cookie (log in first).
- Shopify-backed flows (home page order matching, returns, inventory) need **real** `SHOP_NAME_SHOPIFY` + `ACCESS_TOKEN_SHOPIFY` — placeholders in `.env` are empty, so those flows won't return live data until set.

### Database gotchas (important)

- **Use `npm run db:push` for a fresh DB, not `db:migrate`.** `prisma migrate deploy` FAILS on an empty database: migration `20260201194500_add_galaxus_delivery_note_fields` alters `GalaxusOrder`, but no migration ever `CREATE`s that table (it was pushed out-of-band in prod). `prisma db push` syncs the full `schema.prisma` and works.
- Seed with `npm run db:seed` **after exporting env**: `tsx`-run scripts (seed, `returns:sync`, workers) do NOT auto-load `.env`. Prefix them, e.g. `set -a && . ./.env && set +a && npm run db:seed`. The Next dev server itself does load `.env`, so this only affects `tsx`/CLI scripts.
- On startup you'll see `[SCRAPER] startup recovery skipped: relation "scraper.scrape_runs" does not exist`. This is non-fatal — the `scraper` Postgres schema tables aren't created by `db push`; recovery is skipped gracefully.

### Test / lint / typecheck

- Tests: `npm test` (Vitest). Two pre-existing failures in `app/lib/snowleaderGalaxusCategories.test.ts` (stale category-count/label assertions) are unrelated to setup.
- Lint: `npm run lint` is **non-functional** — `next lint` was removed in Next 16 and no ESLint is configured. Closest quality gate is `npx tsc --noEmit` (has 2 pre-existing type errors in `galaxus/stx/importProduct.test.ts`).
