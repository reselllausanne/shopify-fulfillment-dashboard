/**
 * One-shot: push supplier.* metafields for linked Shopify↔StockX OrderMatches.
 *
 * Usage:
 *   npx tsx scripts/backfill-supplier-order-metafields.ts [--days=90] [--limit=500] [--dry-run]
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import {
  markOrderMatchMetafieldsSynced,
  setSupplierOrderMetafields,
} from "@/shopify/orders/setSupplierMetafields";

function arg(name: string, fallback: number): number {
  const raw = process.argv.find((v) => v.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) ? n : fallback;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const days = arg("days", 90);
  const limit = arg("limit", 500);
  const dryRun = flag("dry-run");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await prisma.orderMatch.findMany({
    where: {
      shopifyOrderId: { not: "" },
      // Real StockX buy refs (same heuristic as AWB backfill).
      stockxOrderNumber: { startsWith: "0" },
      shopifyCreatedAt: { gte: since },
    },
    select: {
      id: true,
      shopifyOrderId: true,
      shopifyOrderName: true,
      stockxOrderNumber: true,
      stockxStatus: true,
      stockxEstimatedDelivery: true,
      supplierCost: true,
      marginAmount: true,
      marginPercent: true,
      stockxAwb: true,
      stockxTrackingUrl: true,
      shopifyMetafieldsSynced: true,
    },
    orderBy: { shopifyCreatedAt: "desc" },
    take: limit,
  });

  console.log(
    `[META-BACKFILL] candidates=${rows.length} days=${days} limit=${limit} dryRun=${dryRun}`
  );

  let ok = 0;
  let fail = 0;
  let skipped = 0;

  for (const row of rows) {
    const stockxOrderNumber = String(row.stockxOrderNumber ?? "").trim();
    const shopifyOrderId = String(row.shopifyOrderId ?? "").trim();
    if (!stockxOrderNumber || !shopifyOrderId) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(
        `[DRY] ${row.shopifyOrderName} → ${stockxOrderNumber} status=${row.stockxStatus || "?"} synced=${row.shopifyMetafieldsSynced}`
      );
      ok += 1;
      continue;
    }

    const result = await setSupplierOrderMetafields({
      shopifyOrderId,
      stockxOrderNumber,
      stockxStatus: row.stockxStatus,
      estimatedDelivery: row.stockxEstimatedDelivery,
      supplierCost: row.supplierCost,
      marginAmount: row.marginAmount,
      marginPercent: row.marginPercent,
      trackingNumber: row.stockxAwb,
      trackingUrl: row.stockxTrackingUrl,
      skipDuplicateCheck: true,
    });

    if (result.ok) {
      await markOrderMatchMetafieldsSynced(row.id);
      ok += 1;
      console.log(`[OK] ${row.shopifyOrderName} → ${stockxOrderNumber} (${result.metafieldCount} fields)`);
    } else {
      fail += 1;
      console.error(`[FAIL] ${row.shopifyOrderName}: ${result.error}`);
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`[META-BACKFILL] done ok=${ok} fail=${fail} skipped=${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
