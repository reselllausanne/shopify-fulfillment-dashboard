#!/usr/bin/env npx tsx
/**
 * Safety-net Shopify STX price refresh (small capped batches).
 *
 * Primary path: SSE ingest → DB update → planned Shopify push only when
 * computed sell ≠ lastPushed (see shopifyStxPriceSyncPlan). This worker
 * catches formula changes / missed events without rescanning the full catalog.
 *
 * Priorisation (2026-09):
 *   - GTIN path: only KickDB products on Shopify (ShopifySyncState synced) —
 *     skips ~134k feed-only rows.
 *   - No-GTIN path (PENDING_GTIN / TCG one-size): same Shopify filter via
 *     KickDB mapping + handle/size match (not barcode).
 *   - Tri par date de dernière synchro croissante: la variante la plus périmée
 *     passe en premier, donc un redémarrage ne peut jamais affamer la fin de
 *     file. La péremption maximale est bornée par la durée d'un cycle.
 *
 * Env:
 *   SHOPIFY_STX_SYNC_INTERVAL_MS   default 3600000 (1h de repos entre cycles)
 *   SHOPIFY_STX_SYNC_INITIAL_DELAY_MS  default 120000
 *   SHOPIFY_STX_SYNC_BATCH_SIZE    default 50 gtins per call
 *   SHOPIFY_STX_SYNC_BATCH_SLEEP_MS  default 1500 (throttle Shopify writes)
 *   SHOPIFY_STX_SYNC_ONLY_ON_SHOPIFY  default "1" (set "0" to scan every GTIN)
 *   SHOPIFY_STX_SYNC_MIN_AGE_HOURS   default 168 (7d safety net; SSE handles hot path)
 *   SHOPIFY_STX_SYNC_MAX_GTINS_PER_CYCLE  default 3000
 *   SHOPIFY_STX_SYNC_PENDING_LIMIT   default 500 (TCG / high stock first)
 */
import { prisma } from "../../app/lib/prisma";
import {
  loadInStockStxNoGtinSupplierVariantIds,
  syncShopifyStxPricesForGtins,
  syncShopifyStxPricesForSupplierVariantIds,
} from "../../shopify/stx/syncShopifyStxPrices";

const INTERVAL_MS = Number(
  process.env.SHOPIFY_STX_SYNC_INTERVAL_MS ?? 60 * 60 * 1000
);
const ONLY_ON_SHOPIFY = !["0", "false", "no"].includes(
  String(process.env.SHOPIFY_STX_SYNC_ONLY_ON_SHOPIFY ?? "1").toLowerCase()
);
const INITIAL_DELAY_MS = Number(
  process.env.SHOPIFY_STX_SYNC_INITIAL_DELAY_MS ?? 120_000
);
const BATCH_SIZE = Math.max(
  1,
  Number(process.env.SHOPIFY_STX_SYNC_BATCH_SIZE ?? 50)
);
const BATCH_SLEEP_MS = Math.max(
  0,
  Number(process.env.SHOPIFY_STX_SYNC_BATCH_SLEEP_MS ?? 1500)
);
// Skip GTINs whose Shopify price was pushed within this window. The SSE ingest
// pushes the current-formula price the moment a StockX ask changes and stamps
// ChannelListingState.lastSyncedAt; a worker push does the same. So anything
// synced inside MIN_AGE is already correct — re-pushing it just burns Shopify
// write quota. 0 disables the guard (full rescan every cycle).
const MIN_AGE_HOURS = Math.max(
  0,
  Number(process.env.SHOPIFY_STX_SYNC_MIN_AGE_HOURS ?? 168)
);
const MAX_GTINS_PER_CYCLE = Math.max(
  0,
  Number(process.env.SHOPIFY_STX_SYNC_MAX_GTINS_PER_CYCLE ?? 3000)
);
const PENDING_LIMIT = Math.max(
  1,
  Number(process.env.SHOPIFY_STX_SYNC_PENDING_LIMIT ?? 500)
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadInStockStxGtins(): Promise<string[]> {
  if (MAX_GTINS_PER_CYCLE <= 0) return [];
  const havingClause =
    MIN_AGE_HOURS <= 0
      ? ""
      : `HAVING MIN(cls."lastSyncedAt") IS NULL
            OR MIN(cls."lastSyncedAt") < NOW() - (${Math.round(MIN_AGE_HOURS)} * INTERVAL '1 hour')`;
  const shopifyJoin = ONLY_ON_SHOPIFY
    ? `JOIN "public"."KickDBVariant" kv
          ON kv."gtin" = sv."gtin" OR kv."ean" = sv."gtin"
        JOIN "public"."KickDBProduct" p ON p."id" = kv."productId"
        JOIN "public"."ShopifySyncState" sss
          ON sss."kickdbProductId" = p."kickdbProductId"
          AND sss."syncStatus" = 'synced'
          AND sss."shopifyProductId" IS NOT NULL`
    : "";
  const rows = await prisma.$queryRawUnsafe<Array<{ gtin: string }>>(`
    SELECT sv."gtin"
    FROM "public"."SupplierVariant" sv
    ${shopifyJoin}
    LEFT JOIN "public"."ChannelListingState" cls
      ON cls."channel" = 'SHOPIFY' AND cls."providerKey" = sv."providerKey"
    WHERE sv."supplierVariantId" LIKE 'stx_%'
      AND sv."gtin" IS NOT NULL
      AND sv."stock" > 0
      AND coalesce(sv."manualLock", false) = false
    GROUP BY sv."gtin"
    ${havingClause}
    ORDER BY MIN(cls."lastSyncedAt") ASC NULLS FIRST
    LIMIT ${Math.floor(MAX_GTINS_PER_CYCLE)}
  `);
  return rows.map((r) => String(r.gtin ?? "").trim()).filter((g) => g.length > 0);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function runOnce(): Promise<void> {
  const startedAt = Date.now();
  let gtins: string[] = [];
  let noGtinSupplierIds: string[] = [];
  try {
    [gtins, noGtinSupplierIds] = await Promise.all([
      loadInStockStxGtins(),
      loadInStockStxNoGtinSupplierVariantIds({
        onlyOnShopify: ONLY_ON_SHOPIFY,
        minAgeHours: MIN_AGE_HOURS,
        limit: PENDING_LIMIT,
      }),
    ]);
  } catch (err: unknown) {
    console.error(
      "[WORKER][SHOPIFY_STX_SYNC] load failed",
      err instanceof Error ? err.message : err
    );
    return;
  }
  const batches = chunk(gtins, BATCH_SIZE);
  const pendingBatches = chunk(noGtinSupplierIds, BATCH_SIZE);
  let synced = 0;
  let skipped = 0;
  let failed = 0;
  const failReasons = new Map<string, number>();

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i]!;
    try {
      const result = await syncShopifyStxPricesForGtins(batch);
      synced += result.synced;
      skipped += result.skipped;
      failed += result.failed;
      for (const row of result.results) {
        if (row.ok) continue;
        const reason = row.reason ?? "unknown";
        failReasons.set(reason, (failReasons.get(reason) ?? 0) + 1);
      }
    } catch (err: unknown) {
      failed += batch.length;
      const reason = err instanceof Error ? err.message : String(err);
      failReasons.set(reason, (failReasons.get(reason) ?? 0) + batch.length);
      console.error("[WORKER][SHOPIFY_STX_SYNC] batch failed", {
        batchIndex: i,
        size: batch.length,
        reason,
      });
    }
    if (BATCH_SLEEP_MS > 0 && i < batches.length - 1) {
      await sleep(BATCH_SLEEP_MS);
    }
  }

  for (let i = 0; i < pendingBatches.length; i += 1) {
    const batch = pendingBatches[i]!;
    try {
      const result = await syncShopifyStxPricesForSupplierVariantIds(batch);
      synced += result.synced;
      skipped += result.skipped;
      failed += result.failed;
      for (const row of result.results) {
        if (row.ok) continue;
        const reason = row.reason ?? "unknown";
        failReasons.set(`pending:${reason}`, (failReasons.get(`pending:${reason}`) ?? 0) + 1);
      }
    } catch (err: unknown) {
      failed += batch.length;
      const reason = err instanceof Error ? err.message : String(err);
      failReasons.set(reason, (failReasons.get(reason) ?? 0) + batch.length);
      console.error("[WORKER][SHOPIFY_STX_SYNC] pending batch failed", {
        batchIndex: i,
        size: batch.length,
        reason,
      });
    }
    if (BATCH_SLEEP_MS > 0 && i < pendingBatches.length - 1) {
      await sleep(BATCH_SLEEP_MS);
    }
  }

  const durationMs = Date.now() - startedAt;
  console.info("[WORKER][SHOPIFY_STX_SYNC] done", {
    gtins: gtins.length,
    pendingNoGtin: noGtinSupplierIds.length,
    batches: batches.length,
    pendingBatches: pendingBatches.length,
    synced,
    skipped,
    failed,
    durationMs,
    failReasons: Object.fromEntries(failReasons),
  });
}

async function main(): Promise<void> {
  console.info("[WORKER][SHOPIFY_STX_SYNC] starting", {
    intervalMs: INTERVAL_MS,
    initialDelayMs: INITIAL_DELAY_MS,
    batchSize: BATCH_SIZE,
    batchSleepMs: BATCH_SLEEP_MS,
    onlyOnShopify: ONLY_ON_SHOPIFY,
    minAgeHours: MIN_AGE_HOURS,
    maxGtinsPerCycle: MAX_GTINS_PER_CYCLE,
    pendingLimit: PENDING_LIMIT,
  });
  await sleep(INITIAL_DELAY_MS);
  while (true) {
    await runOnce();
    await sleep(INTERVAL_MS);
  }
}

main().catch((err: unknown) => {
  console.error("[WORKER][SHOPIFY_STX_SYNC] fatal", err);
  process.exitCode = 1;
});
