#!/usr/bin/env npx tsx
/**
 * Readable Galaxus feed delta dry-run — explains Express→Standard flips and
 * exclusion buckets before any SFTP publish.
 *
 *   npx tsx scripts/galaxus-feed-delta-dry-run.ts
 *   npx tsx scripts/galaxus-feed-delta-dry-run.ts --ratio 2
 */
import { prisma } from "@/app/lib/prisma";
import {
  buildFeedDeltaReport,
  formatFeedDeltaReportText,
  readFeedDeltaGuardConfig,
} from "@/galaxus/exports/feedDeltaGuard";
import { readStxExpressOverStandardMaxRatio } from "@/galaxus/stx/variantPriceLanes";
import {
  REICHELT_DIMENSION_EXCLUSION_RULES,
  REICHELT_MAX_UNIT_DIMENSION_M,
  extractLongestDimensionMetres,
} from "@/galaxus/exports/feedIntegrityRules";

function readArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

async function main() {
  const ratio = Number.parseFloat(readArg("--ratio") ?? "") || readStxExpressOverStandardMaxRatio();
  const guard = readFeedDeltaGuardConfig();

  const flipped = await prisma.$queryRawUnsafe<
    Array<{
      total: number;
      with_stock: number;
      zero_stock: number;
      still_express_bad: number;
    }>
  >(
    `
    SELECT
      COUNT(*) FILTER (
        WHERE "deliveryType" = 'standard'
          AND "expressBuyPrice" IS NOT NULL
          AND "standardBuyPrice" IS NOT NULL
          AND "expressBuyPrice"::numeric >= $1 * "standardBuyPrice"::numeric
      )::int AS total,
      COUNT(*) FILTER (
        WHERE "deliveryType" = 'standard'
          AND stock > 0
          AND "expressBuyPrice" IS NOT NULL
          AND "standardBuyPrice" IS NOT NULL
          AND "expressBuyPrice"::numeric >= $1 * "standardBuyPrice"::numeric
      )::int AS with_stock,
      COUNT(*) FILTER (
        WHERE "deliveryType" = 'standard'
          AND stock = 0
          AND "expressBuyPrice" IS NOT NULL
          AND "standardBuyPrice" IS NOT NULL
          AND "expressBuyPrice"::numeric >= $1 * "standardBuyPrice"::numeric
      )::int AS zero_stock,
      COUNT(*) FILTER (
        WHERE COALESCE("deliveryType",'') LIKE 'express%'
          AND stock > 0
          AND "expressBuyPrice" IS NOT NULL
          AND "standardBuyPrice" IS NOT NULL
          AND "expressBuyPrice"::numeric >= $1 * "standardBuyPrice"::numeric
      )::int AS still_express_bad
    FROM "SupplierVariant"
    WHERE "supplierVariantId" LIKE 'stx\\_%'
    `,
    ratio
  );

  const lastRun = await prisma.$queryRawUnsafe<
    Array<{ countsJson: unknown; startedAt: Date; scope: string }>
  >(
    `
    SELECT "countsJson", "startedAt", scope
    FROM "GalaxusFeedRun"
    WHERE success = true
      AND scope IN ('stock', 'stock-price', 'all')
      AND "countsJson" IS NOT NULL
    ORDER BY "startedAt" DESC
    LIMIT 1
    `
  );

  const prev = (lastRun[0]?.countsJson ?? {}) as Record<string, number | null>;
  const prevStock = typeof prev.stock === "number" ? prev.stock : null;
  const prevOffer = typeof prev.offer === "number" ? prev.offer : null;
  const prevPositive =
    typeof prev.positiveStock === "number"
      ? prev.positiveStock
      : prevStock;

  // REI dimension sample (title scan, capped)
  const reiRows = await prisma.$queryRawUnsafe<
    Array<{ providerKey: string | null; title: string | null }>
  >(
    `
    SELECT "providerKey", "supplierProductName" AS title
    FROM "SupplierVariant"
    WHERE "supplierVariantId" LIKE 'rei\\_%'
      AND stock > 0
    ORDER BY "updatedAt" DESC
    LIMIT 5000
    `
  );
  const reiExclusions: Array<{
    providerKey: string;
    supplier: string;
    reason: string;
    detail?: string;
  }> = [];
  for (const row of reiRows) {
    const title = String(row.title ?? "");
    const metres = extractLongestDimensionMetres(title);
    const neon = /\b(neon|néon|neonröhre)\b/i.test(title);
    if (neon && (metres == null || metres > REICHELT_MAX_UNIT_DIMENSION_M)) {
      reiExclusions.push({
        providerKey: String(row.providerKey ?? ""),
        supplier: "rei",
        reason: metres != null && metres > REICHELT_MAX_UNIT_DIMENSION_M
          ? "REI_DIMENSION_OVER_120CM"
          : "REI_NEON_PRODUCT",
        detail: metres != null ? `${metres.toFixed(2)}m` : "neon",
      });
      continue;
    }
    if (metres != null && metres > REICHELT_MAX_UNIT_DIMENSION_M) {
      reiExclusions.push({
        providerKey: String(row.providerKey ?? ""),
        supplier: "rei",
        reason: "REI_DIMENSION_OVER_120CM",
        detail: `${metres.toFixed(2)}m`,
      });
    }
  }

  const f = flipped[0]!;
  // Simulate: flipped products with stock stay published (lane change only).
  const nextPositive = prevPositive != null ? prevPositive : f.with_stock;
  const report = buildFeedDeltaReport({
    dryRun: true,
    previousStockRows: prevStock,
    previousOfferRows: prevOffer,
    previousPositiveStockRows: prevPositive,
    nextStockRows: prevStock ?? f.with_stock,
    nextOfferRows: prevOffer ?? f.with_stock,
    // If we wrongly zeroed flipped rows, drop would be ~zero_stock + still bad.
    // Correct path: positive stock ≈ unchanged (lane only).
    nextPositiveStockRows: nextPositive,
    expressToStandard: f.total,
    exclusions: [
      ...reiExclusions,
      ...(f.zero_stock > 0
        ? [
            {
              providerKey: "(aggregate)",
              supplier: "stx",
              reason: "STOCK_ZERO_NOT_LANE_CHANGE",
              detail: `${f.zero_stock} flipped rows currently stock=0 (true OOS / asks) — not a delivery demotion`,
            },
          ]
        : []),
    ],
    laneChanges: [
      {
        providerKey: "STX_*",
        supplier: "stx",
        from: "express_*",
        to: "standard",
      },
    ],
    config: guard,
  });

  console.log(formatFeedDeltaReportText(report));
  console.log("---");
  console.log(
    JSON.stringify(
      {
        ratio,
        expressToStandard: {
          total: f.total,
          withStock: f.with_stock,
          zeroStock: f.zero_stock,
          stillExpressOverCap: f.still_express_bad,
        },
        reiDimensionRules: REICHELT_DIMENSION_EXCLUSION_RULES.map((r) => ({
          id: r.id,
          reason: r.reason,
          description: r.description,
        })),
        reiExclusionsSampled: reiExclusions.length,
        reiScanLimit: reiRows.length,
        lastFeedRunAt: lastRun[0]?.startedAt ?? null,
        guard,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
