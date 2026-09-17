#!/usr/bin/env npx tsx
/**
 * One-shot: flip STX SupplierVariant active lane from absurd express → standard
 * when expressBuy >= ratio × standardBuy (default 2 = +100%).
 *
 * Only flips when standard is sellable (implicit: keep catalogue presence).
 * Does NOT touch expressBuyPrice / standardBuyPrice (Shopify dual lane).
 * Rewrites marketplace-facing: price, deliveryType, suggestedRetail*.
 *
 *   npx tsx scripts/backfill-stx-express-over-standard-cap.ts --dry-run
 *   npx tsx scripts/backfill-stx-express-over-standard-cap.ts --apply
 */
import { prisma } from "@/app/lib/prisma";
import { readStxExpressOverStandardMaxRatio } from "@/galaxus/stx/variantPriceLanes";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

async function main() {
  const apply = hasFlag("--apply");
  const dryRun = !apply || hasFlag("--dry-run");
  const gtin = readArg("--gtin");
  const ratio = readStxExpressOverStandardMaxRatio();

  const whereSql = gtin
    ? `AND (gtin = $2 OR "providerKey" = $2 OR "providerKey" = ('STX_' || ltrim($2, '0')))`
    : "";

  const params: Array<number | string> = [ratio];
  if (gtin) params.push(gtin.replace(/^STX_/i, ""));

  const candidates = await prisma.$queryRawUnsafe<
    Array<{
      supplierVariantId: string;
      providerKey: string | null;
      gtin: string | null;
      supplierProductName: string | null;
      price: number;
      standardBuyPrice: number;
      expressBuyPrice: number;
      deliveryType: string | null;
      standardSuggestedRetailPriceInclVat: number | null;
      ratio: number;
    }>
  >(
    `
    SELECT
      "supplierVariantId",
      "providerKey",
      gtin,
      "supplierProductName",
      price::float8 AS price,
      "standardBuyPrice"::float8 AS "standardBuyPrice",
      "expressBuyPrice"::float8 AS "expressBuyPrice",
      "deliveryType",
      "standardSuggestedRetailPriceInclVat"::float8 AS "standardSuggestedRetailPriceInclVat",
      ROUND(("expressBuyPrice"::numeric / NULLIF("standardBuyPrice"::numeric, 0))::numeric, 2)::float8 AS ratio
    FROM "SupplierVariant"
    WHERE "supplierVariantId" LIKE 'stx\\_%'
      AND "standardBuyPrice" IS NOT NULL
      AND "expressBuyPrice" IS NOT NULL
      AND "standardBuyPrice"::numeric > 0
      AND "expressBuyPrice"::numeric >= $1 * "standardBuyPrice"::numeric
      AND COALESCE("deliveryType", '') LIKE 'express%'
      AND stock > 0
      ${whereSql}
    ORDER BY ratio DESC
    LIMIT 50000
    `,
    ...params
  );

  console.log(
    `[stx-express-cap] ratio>=${ratio} candidates=${candidates.length} mode=${dryRun ? "dry-run" : "APPLY"}`
  );

  const sample = candidates.slice(0, 15);
  for (const row of sample) {
    console.log(
      `  ${row.providerKey ?? row.supplierVariantId}  exp=${row.expressBuyPrice} std=${row.standardBuyPrice} ` +
        `ratio=${row.ratio}  "${row.supplierProductName ?? ""}"`
    );
  }
  if (candidates.length > sample.length) {
    console.log(`  … +${candidates.length - sample.length} more`);
  }

  if (dryRun) {
    console.log("[stx-express-cap] dry-run only — pass --apply to write");
    return;
  }

  const result = await prisma.$executeRawUnsafe(
    `
    UPDATE "SupplierVariant" AS t
    SET
      price = t."standardBuyPrice",
      "deliveryType" = 'standard',
      "suggestedRetailPriceInclVat" = COALESCE(
        t."standardSuggestedRetailPriceInclVat",
        t."suggestedRetailPriceInclVat"
      ),
      "updatedAt" = NOW()
    WHERE t."supplierVariantId" LIKE 'stx\\_%'
      AND t."standardBuyPrice" IS NOT NULL
      AND t."expressBuyPrice" IS NOT NULL
      AND t."standardBuyPrice"::numeric > 0
      AND t."expressBuyPrice"::numeric >= $1 * t."standardBuyPrice"::numeric
      AND COALESCE(t."deliveryType", '') LIKE 'express%'
      AND t.stock > 0
      ${whereSql}
    `,
    ...params
  );

  console.log(`[stx-express-cap] updated rows=${result}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
