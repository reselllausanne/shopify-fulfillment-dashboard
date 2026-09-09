#!/usr/bin/env tsx
/**
 * STX aberrant-price detector (semi-automated).
 *
 * Flags STX rows where the buy price is a large outlier vs the median price
 * of the same StockX model (grouped by supplierSku, requires ≥3 sizes).
 * Prints a JSON patch that can be pasted into
 * `galaxus/exports/stxAberrantOverrides.json` after human review.
 *
 * Run:
 *   npx tsx scripts/stx-detect-aberrant.ts                # focus + luxury
 *   npx tsx scripts/stx-detect-aberrant.ts --min-ratio 5  # stricter
 *   npx tsx scripts/stx-detect-aberrant.ts --limit 200
 *
 * Rules:
 *  - Only STX rows in stock with price > 0.
 *  - Bucket must be FOCUS or LUXURY_KEEP (mainstream over 500 is already
 *    culled by the >500 rule; hard cap 10k culls the extreme long tail).
 *  - Consider only price < 10_000 (hard cap already omits above).
 *  - median(price) grouped by supplierSku, at least 3 sizes present.
 *  - price > MIN_RATIO × median AND price > MIN_ABS_CHF.
 *
 * Output:
 *  - CSV to stdout (grep-friendly).
 *  - JSON patch (add to `entries`) to stderr for eyeballing.
 */

import { prisma } from "@/app/lib/prisma";
import { classifyStxBrand } from "@/galaxus/exports/stxBrandBuckets";

type Row = {
  providerKey: string;
  supplierSku: string;
  supplierBrand: string;
  supplierProductName: string;
  price: number;
  medianPrice: number;
  nSizes: number;
  ratio: number;
};

function parseArgs() {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    const k = process.argv[i]?.replace(/^--/, "");
    const v = process.argv[i + 1];
    if (k && v != null) args.set(k, v);
  }
  return {
    minRatio: Number(args.get("min-ratio") ?? 3),
    minAbsChf: Number(args.get("min-abs") ?? 300),
    limit: Number(args.get("limit") ?? 5000),
  };
}

async function main() {
  const { minRatio, minAbsChf, limit } = parseArgs();
  process.stderr.write(
    `[stx-detect-aberrant] minRatio=${minRatio} minAbsChf=${minAbsChf} limit=${limit}\n`
  );

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      providerKey: string | null;
      supplierSku: string | null;
      supplierBrand: string | null;
      supplierProductName: string | null;
      price: string | number | null;
      median_price: string | number | null;
      n_sizes: number | string | null;
    }>
  >(
    `
    WITH stx AS (
      SELECT * FROM "SupplierVariant"
      WHERE "providerKey" ILIKE 'STX\\_%'
        AND stock > 0
        AND price > 0
        AND price < 10000
    ),
    sku_med AS (
      SELECT
        "supplierSku",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS median_price,
        COUNT(*) AS n_sizes
      FROM stx
      WHERE "supplierSku" IS NOT NULL
      GROUP BY "supplierSku"
    )
    SELECT
      s."providerKey",
      s."supplierSku",
      s."supplierBrand",
      s."supplierProductName",
      s.price,
      m.median_price,
      m.n_sizes
    FROM stx s
    JOIN sku_med m ON m."supplierSku" = s."supplierSku"
    WHERE m.n_sizes >= 3
      AND m.median_price > 0
      AND s.price > m.median_price * $1
      AND s.price > $2
    ORDER BY (s.price / NULLIF(m.median_price, 0)) DESC
    LIMIT $3;
    `,
    minRatio,
    minAbsChf,
    limit
  );

  const flagged: Row[] = [];
  for (const r of rows) {
    const bucket = classifyStxBrand(r.supplierBrand);
    if (bucket !== "FOCUS" && bucket !== "LUXURY_KEEP") continue; // mainstream already gated
    const price = Number(r.price);
    const median = Number(r.median_price);
    if (!Number.isFinite(price) || !Number.isFinite(median) || median <= 0) continue;
    flagged.push({
      providerKey: String(r.providerKey ?? "").trim(),
      supplierSku: String(r.supplierSku ?? ""),
      supplierBrand: String(r.supplierBrand ?? ""),
      supplierProductName: String(r.supplierProductName ?? ""),
      price,
      medianPrice: median,
      nSizes: Number(r.n_sizes),
      ratio: price / median,
    });
  }

  // CSV to stdout
  const header = [
    "providerKey",
    "brand",
    "supplierSku",
    "supplierProductName",
    "price",
    "median_price",
    "ratio",
    "n_sizes",
  ].join(",");
  process.stdout.write(header + "\n");
  for (const r of flagged) {
    process.stdout.write(
      [
        r.providerKey,
        r.supplierBrand,
        r.supplierSku,
        `"${r.supplierProductName.replace(/"/g, '""')}"`,
        r.price.toFixed(2),
        r.medianPrice.toFixed(2),
        r.ratio.toFixed(2),
        r.nSizes,
      ].join(",") + "\n"
    );
  }

  // JSON patch to stderr — paste manually into stxAberrantOverrides.json
  const today = new Date().toISOString().slice(0, 10);
  const patch = flagged.map((r) => ({
    providerKey: r.providerKey,
    reason: `aberrant_sku_median_${r.ratio.toFixed(1)}x`,
    addedAt: today,
  }));
  process.stderr.write(
    `\n[stx-detect-aberrant] flagged=${flagged.length}\n` +
      `[stx-detect-aberrant] JSON patch (paste into galaxus/exports/stxAberrantOverrides.json → entries):\n` +
      JSON.stringify(patch, null, 2) +
      "\n"
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
