#!/usr/bin/env npx tsx
/**
 * Nightly Shopify STX price refresh.
 *
 * SSE ingest only pushes Shopify prices when a SupplierVariant row is
 * created/updated in DB. When a StockX ask stays constant over multiple SSE
 * events, Shopify keeps whatever price was last written — even if the sell
 * formula, brand rules, or fee model changed since. This worker closes that
 * gap by scanning the DB (no KicksDB API) for every in-stock STX GTIN and
 * calling syncShopifyStxPricesForGtins in batches so Shopify always reflects
 * the current DB-computed sell price.
 *
 * Env:
 *   SHOPIFY_STX_SYNC_INTERVAL_MS   default 86400000 (24h)
 *   SHOPIFY_STX_SYNC_INITIAL_DELAY_MS  default 120000
 *   SHOPIFY_STX_SYNC_BATCH_SIZE    default 50 gtins per call
 *   SHOPIFY_STX_SYNC_BATCH_SLEEP_MS  default 1500 (throttle Shopify writes)
 */
import { prisma } from "../../app/lib/prisma";
import { syncShopifyStxPricesForGtins } from "../../shopify/stx/syncShopifyStxPrices";

const INTERVAL_MS = Number(
  process.env.SHOPIFY_STX_SYNC_INTERVAL_MS ?? 24 * 60 * 60 * 1000
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadInStockStxGtins(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ gtin: string }>>`
    SELECT DISTINCT sv."gtin"
    FROM "public"."SupplierVariant" sv
    WHERE sv."supplierVariantId" LIKE 'stx_%'
      AND sv."gtin" IS NOT NULL
      AND sv."stock" > 0
      AND coalesce(sv."manualLock", false) = false
  `;
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
  try {
    gtins = await loadInStockStxGtins();
  } catch (err: unknown) {
    console.error(
      "[WORKER][SHOPIFY_STX_SYNC] load failed",
      err instanceof Error ? err.message : err
    );
    return;
  }
  const batches = chunk(gtins, BATCH_SIZE);
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

  const durationMs = Date.now() - startedAt;
  console.info("[WORKER][SHOPIFY_STX_SYNC] done", {
    gtins: gtins.length,
    batches: batches.length,
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
