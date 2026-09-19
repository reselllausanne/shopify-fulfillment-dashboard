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

## App deploy

1. Merge/deploy branch (normal VPS path).
2. Before/after compare (read-only):

```bash
npx tsx scripts/compare-galaxus-feed-image-gate.ts --limit=50000
# full catalog when ready:
# npx tsx scripts/compare-galaxus-feed-image-gate.ts
```

Expect `pass: exact_match` or `within_0_1pct`. Investigate any larger `catalogReady` delta before trusting stock/offer pushes.

3. Smoke: stock + offer dry-run export row counts vs previous snapshot (same query params).

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
