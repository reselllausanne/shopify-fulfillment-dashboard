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
import { syncShopifyStxPricesForSupplierVariantIds } from "@/shopify/stx/syncShopifyStxPrices";

function flag(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const APPLY = process.argv.includes("--apply");
const LIMIT = flag("limit", 500);
const BATCH = flag("batch", 50);
const MAX_DELTA_PCT = flag("max-delta-pct", 35);
const MAX_PRICE = flag("max-price", 5000);
const STALE_HOURS = flag("stale-hours", 0);

type Row = {
  supplierVariantId: string;
  name: string | null;
  buy: number;
  lastPushedPrice: number | null;
  lastSyncAt: Date | null;
};

async function main() {
  console.log(
    `${APPLY ? "MODE: APPLY" : "MODE: DRY-RUN"} | lock=${SHOPIFY_PRICING_LOCK_VERSION} | limite=${LIMIT} | garde-fou=${MAX_DELTA_PCT}%`
  );

  const staleClause = STALE_HOURS
    ? `AND (sv."lastSyncAt" IS NULL OR sv."lastSyncAt" < NOW() - INTERVAL '${Math.round(STALE_HOURS)} hours')`
    : "";

  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT sv."supplierVariantId",
           sv."supplierProductName" AS name,
           COALESCE(sv."standardBuyPrice", sv.price)::float AS buy,
           cls."lastPushedPrice"::float AS "lastPushedPrice",
           sv."lastSyncAt"
    FROM "SupplierVariant" sv
    LEFT JOIN "ChannelListingState" cls
      ON cls."supplierVariantId" = sv."supplierVariantId" AND cls.channel = 'SHOPIFY'
    WHERE sv.stock > 0
      AND sv."manualLock" IS DISTINCT FROM TRUE
      AND sv."supplierVariantId" LIKE 'stx_%'
      AND COALESCE(sv."standardBuyPrice", sv.price) > 0
      ${staleClause}
    ORDER BY sv."lastSyncAt" ASC NULLS FIRST
    LIMIT ${Math.max(1, LIMIT)}
  `);

  console.log(`Variantes candidates: ${rows.length}`);
  if (rows.length === 0) return;

  const toSync: string[] = [];
  const blocked: Array<{ id: string; from: number; to: number; pct: number; name: string }> = [];
  let noReference = 0;
  let unchanged = 0;

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
    if (current == null || current <= 0) {
      noReference += 1;
      toSync.push(row.supplierVariantId);
      continue;
    }
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
    toSync.push(row.supplierVariantId);
  }

  console.log(
    `A republier: ${toSync.length} | inchangees: ${unchanged} | sans prix de reference: ${noReference} | bloquees par le garde-fou: ${blocked.length}`
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
  for (let i = 0; i < toSync.length; i += BATCH) {
    const chunk = toSync.slice(i, i + BATCH);
    const res = await syncShopifyStxPricesForSupplierVariantIds(chunk);
    synced += res.synced;
    skipped += res.skipped;
    failed += res.failed;
    console.log(
      `  lot ${Math.floor(i / BATCH) + 1}: +${res.synced} pousses, ${res.skipped} ignores, ${res.failed} echecs (cumul ${synced})`
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
