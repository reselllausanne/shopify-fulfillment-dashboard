#!/usr/bin/env npx tsx
/**
 * Readable Galaxus feed delta dry-run — explains Express→Standard flips and
 * exclusion buckets before any SFTP publish.
 *
 *   npx tsx scripts/galaxus-feed-delta-dry-run.ts
 *   npx tsx scripts/galaxus-feed-delta-dry-run.ts --ratio 2
 *   npx tsx scripts/galaxus-feed-delta-dry-run.ts --rei-page 500
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
  shouldOmitReicheltByIntegrity,
} from "@/galaxus/exports/feedIntegrityRules";

function readArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

type ReiRow = {
  supplierVariantId: string;
  providerKey: string | null;
  title: string | null;
  brand: string | null;
  manualNote: string | null;
};

async function scanAllReicheltInStock(pageSize: number): Promise<{
  scanned: number;
  exclusions: Array<{
    providerKey: string;
    supplier: string;
    reason: string;
    detail?: string;
  }>;
  byReason: Record<string, number>;
  samples: Record<string, string[]>;
}> {
  const exclusions: Array<{
    providerKey: string;
    supplier: string;
    reason: string;
    detail?: string;
  }> = [];
  const byReason: Record<string, number> = {};
  const samples: Record<string, string[]> = {};
  let scanned = 0;
  let afterId = "";

  while (true) {
    const page = await prisma.$queryRawUnsafe<ReiRow[]>(
      `
      SELECT
        "supplierVariantId",
        "providerKey",
        "supplierProductName" AS title,
        "supplierBrand" AS brand,
        "manualNote"
      FROM "SupplierVariant"
      WHERE "supplierVariantId" LIKE 'rei\\_%'
        AND stock > 0
        AND "supplierVariantId" > $1
      ORDER BY "supplierVariantId" ASC
      LIMIT $2
      `,
      afterId,
      pageSize
    );
    if (page.length === 0) break;

    for (const row of page) {
      scanned += 1;
      afterId = row.supplierVariantId;
      const hit = shouldOmitReicheltByIntegrity({
        supplierKey: "rei",
        title: row.title,
        brand: row.brand,
        manualNote: row.manualNote,
      });
      if (!hit.omit || !hit.reason) continue;
      const providerKey = String(row.providerKey ?? row.supplierVariantId);
      exclusions.push({
        providerKey,
        supplier: "rei",
        reason: hit.reason,
        detail: hit.detail,
      });
      byReason[hit.reason] = (byReason[hit.reason] ?? 0) + 1;
      const sampleList = samples[hit.reason] ?? (samples[hit.reason] = []);
      if (sampleList.length < 10) {
        sampleList.push(`${providerKey} ${hit.detail ?? ""}`.trim());
      }
    }

    if (page.length < pageSize) break;
  }

  return { scanned, exclusions, byReason, samples };
}

async function main() {
  const ratio = Number.parseFloat(readArg("--ratio") ?? "") || readStxExpressOverStandardMaxRatio();
  const reiPage = Math.max(100, Number.parseInt(readArg("--rei-page") ?? "1000", 10) || 1000);
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
    typeof prev.positiveStock === "number" ? prev.positiveStock : prevStock;

  const rei = await scanAllReicheltInStock(reiPage);

  const f = flipped[0]!;
  const nextPositive = prevPositive != null ? prevPositive : f.with_stock;
  const report = buildFeedDeltaReport({
    dryRun: true,
    previousStockRows: prevStock,
    previousOfferRows: prevOffer,
    previousPositiveStockRows: prevPositive,
    nextStockRows: prevStock ?? f.with_stock,
    nextOfferRows: prevOffer ?? f.with_stock,
    nextPositiveStockRows: nextPositive,
    expressToStandard: f.total,
    exclusions: [
      ...rei.exclusions,
      ...(f.zero_stock > 0
        ? [
            {
              providerKey: "(aggregate)",
              supplier: "stx",
              reason: "STOCK_ZERO_REQUIRES_SOURCE_RECHECK",
              detail: `${f.zero_stock} flipped rows currently stock=0 — recheck KickDB asks before calling true OOS`,
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
          zeroStockRequiresSourceRecheck: f.zero_stock,
          stillExpressOverCap: f.still_express_bad,
        },
        reiDimensionRules: REICHELT_DIMENSION_EXCLUSION_RULES.map((r) => ({
          id: r.id,
          reason: r.reason,
          description: r.description,
        })),
        reiInStockScan: {
          scanned: rei.scanned,
          totalExclusions: rei.exclusions.length,
          byReason: rei.byReason,
          samples: rei.samples,
        },
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
