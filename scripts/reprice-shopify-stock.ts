/**
 * Republish Shopify sell prices for live StockX stock.
 *
 * A formula change only reaches the storefront when each variant is re-synced.
 * The 25 August increase took two weeks to land because 152k in-stock variants
 * had not been touched for over a week; a decrease would crawl the same way.
 * This walks the catalogue oldest-sync-first and pushes the locked price.
 *
 * Guardrails
 *  - absolute ceiling (`--max-price`, default 5000 CHF): catches a cost that
 *    survived the upstream outlier filter. Applies to every variant.
 *  - relative move (`--max-delta-pct`, default 35%): only for variants where
 *    `ChannelListingState` holds a previously pushed Shopify price. That table
 *    covers a few hundred rows today, so treat it as a bonus check, not cover.
 *
 *   npx tsx scripts/reprice-shopify-stock.ts --limit=200
 *   npx tsx scripts/reprice-shopify-stock.ts --apply --limit=5000
 *   npx tsx scripts/reprice-shopify-stock.ts --apply --stale-hours=48
 */
import "dotenv/config";

import { prisma } from "@/app/lib/prisma";
import {
  calcShopifySellFromSourceCost,
  SHOPIFY_PRICING_LOCK_VERSION,
} from "@/shopify/pricing/calcShopifySellPrice";
import {
  syncShopifyStxPricesForGtins,
  syncShopifyStxPricesForSupplierVariantIds,
} from "@/shopify/stx/syncShopifyStxPrices";

function flag(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function intFlagAllowZero(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

const APPLY = process.argv.includes("--apply");
const LIMIT = flag("limit", 500);
const BATCH = flag("batch", 50);
const MAX_DELTA_PCT = flag("max-delta-pct", 35);
const MAX_PRICE = flag("max-price", 5000);
const STALE_HOURS = flag("stale-hours", 0);
// Parallelism: run N copies with --shards=N --shard=0..N-1 to drain the backlog
// in parallel without overlap (each process owns a disjoint hash slice).
const SHARDS = Math.max(1, intFlagAllowZero("shards", 1));
const SHARD = Math.min(SHARDS - 1, intFlagAllowZero("shard", 0));
// Skip rows already pushed within this window so restarts and parallel passes
// don't re-walk fresh variants. 0 = process everything (default).
const SKIP_FRESH_HOURS = intFlagAllowZero("skip-fresh-hours", 0);

type Row = {
  supplierVariantId: string;
  gtin: string | null;
  name: string | null;
  buy: number;
  lastPushedPrice: number | null;
  lastSyncAt: Date | null;
};

async function main() {
  console.log(
    `${APPLY ? "MODE: APPLY" : "MODE: DRY-RUN"} | lock=${SHOPIFY_PRICING_LOCK_VERSION} | limite=${LIMIT} | garde-fou=${MAX_DELTA_PCT}%`
  );

  if (SHARDS > 1) {
    console.log(`SHARD ${SHARD}/${SHARDS} | skip-fresh-hours=${SKIP_FRESH_HOURS}`);
  }

  const staleClause = STALE_HOURS
    ? `AND (sv."lastSyncAt" IS NULL OR sv."lastSyncAt" < NOW() - INTERVAL '${Math.round(STALE_HOURS)} hours')`
    : "";
  const shardClause =
    SHARDS > 1
      ? `AND (abs(hashtextextended(COALESCE(sv."gtin", sv."supplierVariantId"), 0)) % ${SHARDS}) = ${SHARD}`
      : "";
  // NULL lastSyncedAt = never pushed → always in scope. Only skip rows pushed
  // inside the window so parallel passes / restarts don't re-walk fresh work.
  const skipFreshClause = SKIP_FRESH_HOURS
    ? `AND (cls."lastSyncedAt" IS NULL OR cls."lastSyncedAt" < NOW() - INTERVAL '${Math.round(SKIP_FRESH_HOURS)} hours')`
    : "";

  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT sv."supplierVariantId",
           sv."gtin",
           sv."supplierProductName" AS name,
           COALESCE(sv."standardBuyPrice", sv.price)::float AS buy,
           cls."lastPushedPrice"::float AS "lastPushedPrice",
           sv."lastSyncAt"
    FROM "SupplierVariant" sv
    JOIN "KickDBVariant" kv
      ON kv."gtin" = sv."gtin" OR kv."ean" = sv."gtin"
    JOIN "KickDBProduct" p ON p."id" = kv."productId"
    JOIN "ShopifySyncState" sss
      ON sss."kickdbProductId" = p."kickdbProductId"
    LEFT JOIN "ChannelListingState" cls
      ON cls."supplierVariantId" = sv."supplierVariantId" AND cls.channel = 'SHOPIFY'
    WHERE sv.stock > 0
      AND sv."manualLock" IS DISTINCT FROM TRUE
      AND sv."supplierVariantId" LIKE 'stx_%'
      AND COALESCE(sv."standardBuyPrice", sv.price) > 0
      AND sss."syncStatus" = 'synced'
      AND sss."shopifyProductId" IS NOT NULL
      ${staleClause}
      ${shardClause}
      ${skipFreshClause}
    ORDER BY sv."lastSyncAt" ASC NULLS FIRST
    LIMIT ${Math.max(1, LIMIT)}
  `);

  console.log(`Variantes candidates: ${rows.length}`);
  if (rows.length === 0) return;

  // GTIN path is the real Shopify writer. The supplierVariantId path refuses
  // any row that has a GTIN (has_gtin_use_gtin_path) — that was why a 5k
  // --apply only pushed ~67 (no-GTIN leftovers) and skipped the rest.
  const gtinsToSync: string[] = [];
  const noGtinIds: string[] = [];
  const blocked: Array<{ id: string; from: number; to: number; pct: number; name: string }> = [];
  let noReference = 0;
  let unchanged = 0;
  const seenGtin = new Set<string>();

  for (const row of rows) {
    const target = calcShopifySellFromSourceCost(row.buy);
    if (target == null) continue;
    if (target > MAX_PRICE) {
      blocked.push({
        id: row.supplierVariantId,
        from: row.lastPushedPrice ?? 0,
        to: target,
        pct: 0,
        name: `PLAFOND ${(row.name ?? "").slice(0, 36)}`,
      });
      continue;
    }
    const current = row.lastPushedPrice;
    if (current != null && current > 0) {
      if (Math.abs(target - current) < 0.5) {
        unchanged += 1;
        continue;
      }
      const pct = Math.abs((target - current) / current) * 100;
      if (pct > MAX_DELTA_PCT) {
        blocked.push({
          id: row.supplierVariantId,
          from: current,
          to: target,
          pct: Math.round(pct),
          name: (row.name ?? "").slice(0, 44),
        });
        continue;
      }
    } else {
      noReference += 1;
    }

    const gtin = String(row.gtin ?? "").trim();
    if (gtin) {
      if (!seenGtin.has(gtin)) {
        seenGtin.add(gtin);
        gtinsToSync.push(gtin);
      }
    } else {
      noGtinIds.push(row.supplierVariantId);
    }
  }

  console.log(
    `A republier: gtin=${gtinsToSync.length} noGtin=${noGtinIds.length} | inchangees: ${unchanged} | sans prix de reference: ${noReference} | bloquees par le garde-fou: ${blocked.length}`
  );
  if (blocked.length > 0) {
    console.log("\nBLOQUEES (verifier le cout avant de forcer):");
    for (const b of blocked.slice(0, 15)) {
      console.log(`  ${b.pct}%  ${b.from} -> ${b.to}  ${b.name}  (${b.id})`);
    }
  }

  if (!APPLY) {
    console.log("\nRelancer avec --apply pour pousser vers Shopify.");
    return;
  }

  let synced = 0;
  let skipped = 0;
  let failed = 0;
  for (let i = 0; i < gtinsToSync.length; i += BATCH) {
    const chunk = gtinsToSync.slice(i, i + BATCH);
    const res = await syncShopifyStxPricesForGtins(chunk);
    synced += res.synced;
    skipped += res.skipped;
    failed += res.failed;
    console.log(
      `  gtin lot ${Math.floor(i / BATCH) + 1}: +${res.synced} pousses, ${res.skipped} ignores, ${res.failed} echecs (cumul ${synced})`
    );
  }
  for (let i = 0; i < noGtinIds.length; i += BATCH) {
    const chunk = noGtinIds.slice(i, i + BATCH);
    const res = await syncShopifyStxPricesForSupplierVariantIds(chunk);
    synced += res.synced;
    skipped += res.skipped;
    failed += res.failed;
    console.log(
      `  noGtin lot ${Math.floor(i / BATCH) + 1}: +${res.synced} pousses, ${res.skipped} ignores, ${res.failed} echecs (cumul ${synced})`
    );
  }
  console.log(`\nRESUME: pousses=${synced} ignores=${skipped} echecs=${failed}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
