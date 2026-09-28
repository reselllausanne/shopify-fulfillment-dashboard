# DB performance Phase 1–2 — deploy runbook (approved 2026-09-19)

Branch: `perf/db-phase1-2-select-slim`  
Checkout: from this repo at that branch (or the PR commit once pushed).

## Scope (approved)

| Item | Action |
|---|---|
| Stock/offer Prisma selects | Slim — no `images` JSONB on wire; `hasImageSignal` via URL short-circuit + boolean presence lookup |
| Master/specs `FEED_MAPPING_INCLUDE` | Unchanged (still needs image URLs for CSV emit) |
| GTIN expression index | Ops SQL `CREATE INDEX CONCURRENTLY` — not Prisma `@@index` |
| StxImportSlug | `VACUUM (ANALYZE)` via ops SQL |
| Ads GIN `targeted_campaign_ids` | `DROP INDEX CONCURRENTLY` via ops SQL; removed from `schema.prisma` |
| Ads `last_seen` / `is_current` indexes | **Hold** |
| VariantMapping REINDEX | **Hold** until pgstatindex/pgstattuple proof (`ops/sql/20260919_variantmapping_reindex_HOLD.sql`) |
| VACUUM FULL (SV + ads) | **Rejected** |

## App deploy / pre-merge gates

Do **not** merge until all three pass. Do **not** run ops SQL until merge+CI green (or explicitly after CI on this branch).

1. Exact image-gate ID sets (not totals):

```bash
# dotenv only — never `source .env`
npx tsx scripts/compare-galaxus-feed-image-gate.ts --limit=50000 --out=tmp/gate-compare.json
# full catalog:
# npx tsx scripts/compare-galaxus-feed-image-gate.ts --out=tmp/gate-compare-full.json
```

Single-pass (legacy+slim on same rows). Presence = `pickGalaxusProductImageList` would find ≥1 absolute http(s) URL — not “JSONB non-empty”.

Expect exit 0 with `"pass": "exact_id_match"`, `exactEligible: true`, `exactRejected: true`.

2. Stock + offer dry-run (CSV in-process, no Galaxus push):

```bash
npx tsx scripts/galaxus-feed-row-counts.ts --stock-offer-only --out=tmp/stock-offer-keys.json
```

Same row counts + exact ProviderKey sets vs pre-change snapshot. No product disappears.

3. Build/CI green on the PR.

4. **Only after** 1–3: run `ops/sql/20260919_db_perf_phase2_concurrent.sql` (non-transactional).

## App deploy (after merge)

Normal VPS path from `main` after PR merge — not automatic from this push.
## DB ops (separate from `prisma migrate`)

Run **outside** any transaction (Supabase SQL editor / `psql`):

```bash
# File: ops/sql/20260919_db_perf_phase2_concurrent.sql
```

Contains:

1. `CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierVariant_normalized_gtin_idx" ON "SupplierVariant" ((regexp_replace("gtin", '^0+', '')));`
2. `VACUUM (ANALYZE) "StxImportSlug";`
3. `DROP INDEX CONCURRENTLY IF EXISTS "ads_shopping_product_current_targeted_campaign_ids_gin_idx";`

Then:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM "SupplierVariant"
WHERE regexp_replace("gtin", '^0+', '') = '191448538818';
-- expect Index Scan on SupplierVariant_normalized_gtin_idx

SELECT relname, n_dead_tup, last_vacuum
FROM pg_stat_user_tables WHERE relname = 'StxImportSlug';
-- expect n_dead_tup near 0
```

`prisma migrate deploy` applies a **no-op** migration that only documents the GIN removal in history. It does **not** run CONCURRENTLY DDL.

## Grep notes (ads GIN)

- Column `targeted_campaign_ids` still used in adsanalytics (`ANY(...)`, funnel, overlap).
- GIN had `idx_scan = 0` over 259d — planner was not using it; drop is write-amp win.
- Keep `shopify_variant_id`, `last_seen_run_id`, `is_current` indexes.

## Why slim works

- Live: ~722k rows are images-JSONB-only (no URL). URL-only gate would false-negative.
- Fix: keep URL columns in SELECT; for URL-miss rows, SQL returns boolean `hasImages` only — no JSONB bytes to app.
- `accumulateBestCandidates` / Galaxus–STX flow unchanged; only payload shape for the gate.
