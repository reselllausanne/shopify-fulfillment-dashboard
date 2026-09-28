/**
 * Recompute StockX lane prices from the stored KickDB payload and write the truth.
 *
 * Until the COALESCE fix, a lane that disappeared from StockX kept its last known
 * price forever. 22.7k in-stock variants still carry an express price; on a live
 * 400-row sample 269 had no express lane at all and the remaining 131 were stale.
 * This walks the affected rows, re-derives both lanes from `KickDBProduct.rawJson`
 * and writes through the fixed path so absent lanes are cleared.
 *
 * Dry-run by default.
 *
 *   npx tsx scripts/repair-stx-lane-prices.ts
 *   npx tsx scripts/repair-stx-lane-prices.ts --apply --limit=5000
 */
import "dotenv/config";

import { prisma } from "@/app/lib/prisma";
import { bulkUpdateSupplierVariants } from "@/galaxus/jobs/bulkSql";
import { buildStxDualPriceFields, stxProductAskMedian } from "@/galaxus/stx/variantPriceLanes";

const APPLY = process.argv.includes("--apply");
const LIMIT = Number(
  process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "100000"
);
const BATCH = 500;

type Row = {
  supplierVariantId: string;
  price: number;
  standardBuyPrice: number | null;
  expressBuyPrice: number | null;
};

async function main() {
  console.log(APPLY ? "MODE: APPLY" : "MODE: DRY-RUN");

  // Suspect rows: an express lane that undercuts standard can only come from stale data.
  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT "supplierVariantId",
           price::float AS "price",
           "standardBuyPrice"::float AS "standardBuyPrice",
           "expressBuyPrice"::float AS "expressBuyPrice"
    FROM "SupplierVariant"
    WHERE stock > 0
      AND "manualLock" IS DISTINCT FROM TRUE
      AND "expressBuyPrice" IS NOT NULL
      AND "standardBuyPrice" IS NOT NULL
      AND "expressBuyPrice" < "standardBuyPrice"
    LIMIT ${Math.max(1, LIMIT)}
  `);
  console.log(`Variantes suspectes: ${rows.length}`);
  if (rows.length === 0) return;

  const stats = {
    scanned: 0,
    noPayload: 0,
    unchanged: 0,
    expressCleared: 0,
    standardCleared: 0,
    repriced: 0,
    written: 0,
  };

  let pending: Parameters<typeof bulkUpdateSupplierVariants>[0] = [];

  /** One payload lookup per chunk instead of per row: 22.7k rows is otherwise an hour. */
  async function loadPayloads(chunk: Row[]) {
    const ids = chunk.map((r) => r.supplierVariantId.replace(/^stx_/i, ""));
    const found = await prisma.$queryRawUnsafe<
      Array<{ variantId: string; raw: unknown; name: string | null }>
    >(
      `SELECT v."kickdbVariantId" AS "variantId", p."rawJson" AS raw, p.name AS name
       FROM "KickDBVariant" v JOIN "KickDBProduct" p ON p.id = v."productId"
       WHERE v."kickdbVariantId" = ANY($1::text[])`,
      ids
    );
    return new Map(found.map((f) => [f.variantId, f]));
  }

  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const chunk = rows.slice(offset, offset + BATCH);
    const payloads = await loadPayloads(chunk);

    for (const row of chunk) {
      stats.scanned += 1;
      const variantId = row.supplierVariantId.replace(/^stx_/i, "");
      const found = payloads.get(variantId);
      const raw = found?.raw as Record<string, unknown> | undefined;
      const variants = Array.isArray(raw?.variants)
        ? (raw!.variants as Array<Record<string, unknown>>)
        : [];
      const match = variants.find((v) => String(v.id ?? "") === variantId);
      if (!raw || !match) {
        stats.noPayload += 1;
        continue;
      }

      const lanes = buildStxDualPriceFields(match, raw, found?.name ?? null, {
        productAskMedian: stxProductAskMedian(variants),
      });
      // No usable lane left: leave stock/price handling to the normal sync rather
      // than guessing here.
      if (!lanes) {
        stats.noPayload += 1;
        continue;
      }

      const expressCleared = row.expressBuyPrice != null && lanes.expressBuyPrice == null;
      const standardCleared = row.standardBuyPrice != null && lanes.standardBuyPrice == null;
      const priceChanged = Math.abs(lanes.price - row.price) > 0.01;
      if (!expressCleared && !standardCleared && !priceChanged) {
        stats.unchanged += 1;
        continue;
      }
      if (expressCleared) stats.expressCleared += 1;
      if (standardCleared) stats.standardCleared += 1;
      if (priceChanged) stats.repriced += 1;

      if (stats.written < 10) {
        console.log(
          `  ${row.supplierVariantId}: price ${row.price} -> ${lanes.price} | std ${row.standardBuyPrice} -> ${lanes.standardBuyPrice} | express ${row.expressBuyPrice} -> ${lanes.expressBuyPrice}`
        );
      }

      pending.push({
        supplierVariantId: row.supplierVariantId,
        price: lanes.price,
        stock: lanes.stock,
        deliveryType: lanes.deliveryType,
        suggestedRetailPriceInclVat: lanes.suggestedRetailPriceInclVat,
        standardBuyPrice: lanes.standardBuyPrice,
        expressBuyPrice: lanes.expressBuyPrice,
        standardSuggestedRetailPriceInclVat: lanes.standardSuggestedRetailPriceInclVat,
        lanesEvaluated: true,
      });
      stats.written += 1;
    }

    if (APPLY && pending.length > 0) {
      await bulkUpdateSupplierVariants(pending, new Date());
      pending = [];
      console.log(`  ... ${stats.scanned}/${rows.length} parcourues, ${stats.written} ecrites`);
    }
  }

  if (APPLY && pending.length > 0) {
    await bulkUpdateSupplierVariants(pending, new Date());
  }

  console.log("\nRESUME", JSON.stringify(stats, null, 2));
  if (!APPLY) console.log("Relancer avec --apply pour ecrire.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
