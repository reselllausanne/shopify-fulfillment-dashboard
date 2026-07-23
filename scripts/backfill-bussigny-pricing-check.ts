/**
 * Audit + optional fix liquidation pricing for every variant with stock at Bussigny.
 *
 * Expected:
 *   sell (price)     = calc_touch_price(stockx raw) − 30%
 *   compareAt        = calcShopifySellPrice(stockx raw)
 *
 * Usage:
 *   npx tsx scripts/backfill-bussigny-pricing-check.ts              # dry-run report
 *   npx tsx scripts/backfill-bussigny-pricing-check.ts --write       # apply via convergeVariant
 *   npx tsx scripts/backfill-bussigny-pricing-check.ts --json       # machine-readable
 */
import { prisma } from "../app/lib/prisma";
import { LOCATIONS } from "../shopify/inventory/locationConfig";
import { convergeVariant } from "../shopify/inventory/convergence";
import { findShopifyVariantByGtin } from "../shopify/restock/shopifyRestockInventory";
import { resolvePhysicalRestockPricing } from "../shopify/restock/physicalRestockPricing";

const BUSSIGNY_ID =
  (process.env.SHOPIFY_LOC_BUSSIGNY ?? "").trim() ||
  LOCATIONS.find((l) => /bussigny/i.test(l.name))?.id ||
  "gid://shopify/Location/111267971458";

type Row = {
  gtin: string;
  sku: string | null;
  shopifyVariantId: string;
  available: number;
  locationName: string;
};

type AuditRow = Row & {
  currentPrice: number | null;
  currentCompareAt: number | null;
  expectedSell: number | null;
  expectedCompareAt: number | null;
  expectedCost: number | null;
  pricingSource: string;
  priceOk: boolean;
  compareOk: boolean;
  needsFix: boolean;
  warnings: string[];
};

function toNum(x: unknown): number | null {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function priceMatch(a: number | null, b: number | null, tol = 0.005): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= tol;
}

async function loadBussignyRows(): Promise<Row[]> {
  return prisma.$queryRaw<Row[]>`
    SELECT
      s."gtin"              AS gtin,
      s."sku"               AS sku,
      s."shopifyVariantId"  AS "shopifyVariantId",
      s."available"         AS available,
      s."locationName"      AS "locationName"
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."locationId" = ${BUSSIGNY_ID}
      AND s."available"  > 0
      AND s."gtin" IS NOT NULL
      AND length(trim(s."gtin")) > 0
    ORDER BY s."available" DESC, s."gtin" ASC
  `;
}

async function auditRow(row: Row): Promise<AuditRow> {
  const warnings: string[] = [];
  let currentPrice: number | null = null;
  let currentCompareAt: number | null = null;

  try {
    const { match, ambiguous } = await findShopifyVariantByGtin(row.gtin);
    if (ambiguous) warnings.push("ambiguous GTIN on Shopify");
    currentPrice = match?.price ?? null;
    currentCompareAt = match?.compareAtPrice ?? null;
  } catch (err: any) {
    warnings.push(`Shopify lookup: ${err?.message ?? err}`);
  }

  const pricing = await resolvePhysicalRestockPricing(row.gtin);
  const expectedSell = pricing.sellPrice;
  const expectedCompareAt = pricing.compareAt;
  const expectedCost = pricing.cost;

  if (!expectedSell || !expectedCompareAt) {
    warnings.push(`no StockX pricing (${pricing.source})`);
  }

  const priceOk = priceMatch(currentPrice, expectedSell);
  const compareOk = priceMatch(currentCompareAt, expectedCompareAt);
  const needsFix =
    Boolean(expectedSell && expectedCompareAt) && (!priceOk || !compareOk);

  return {
    ...row,
    currentPrice,
    currentCompareAt,
    expectedSell,
    expectedCompareAt,
    expectedCost,
    pricingSource: pricing.source,
    priceOk,
    compareOk,
    needsFix,
    warnings,
  };
}

async function main() {
  const write = process.argv.includes("--write");
  const jsonOut = process.argv.includes("--json");

  const rows = await loadBussignyRows();
  const audits: AuditRow[] = [];

  for (const row of rows) {
    audits.push(await auditRow(row));
  }

  const needsFix = audits.filter((a) => a.needsFix);
  const noPricing = audits.filter((a) => !a.expectedSell || !a.expectedCompareAt);
  const ok = audits.filter((a) => !a.needsFix && a.expectedSell && a.expectedCompareAt);

  const summary = {
    locationId: BUSSIGNY_ID,
    scanned: audits.length,
    ok: ok.length,
    needsFix: needsFix.length,
    noPricing: noPricing.length,
    write,
  };

  if (jsonOut) {
    console.log(JSON.stringify({ summary, audits, needsFix }, null, 2));
  } else {
    console.log("=== Bussigny liquidation pricing audit ===");
    console.log(JSON.stringify(summary, null, 2));
    console.log("");

    if (needsFix.length) {
      console.log(`--- NEEDS FIX (${needsFix.length}) ---`);
      for (const a of needsFix) {
        console.log(
          [
            a.gtin,
            a.sku ?? "?",
            `qty=${a.available}`,
            `cur ${a.currentPrice ?? "?"} / ${a.currentCompareAt ?? "?"}`,
            `exp ${a.expectedSell ?? "?"} / ${a.expectedCompareAt ?? "?"}`,
            `src=${a.pricingSource}`,
          ].join(" | ")
        );
      }
      console.log("");
    }

    if (noPricing.length) {
      console.log(`--- NO STOCKX PRICING (${noPricing.length}) ---`);
      for (const a of noPricing) {
        console.log(`${a.gtin} | ${a.sku ?? "?"} | qty=${a.available} | src=${a.pricingSource}`);
      }
      console.log("");
    }

    if (ok.length) {
      console.log(`--- OK (${ok.length}) ---`);
      for (const a of ok.slice(0, 10)) {
        console.log(`${a.gtin} | ${a.sku ?? "?"} | ${a.currentPrice}/${a.currentCompareAt}`);
      }
      if (ok.length > 10) console.log(`... +${ok.length - 10} more`);
    }
  }

  if (write) {
    let changed = 0;
    let errors = 0;
    for (const a of needsFix) {
      try {
        const res = await convergeVariant(a.gtin);
        if (res.changed) changed += 1;
        if (res.error || res.warnings.length) {
          console.error(`[write] ${a.gtin}`, res.error ?? res.warnings.join("; "));
        }
      } catch (err: any) {
        errors += 1;
        console.error(`[write] ${a.gtin} failed:`, err?.message ?? err);
      }
    }
    console.log(JSON.stringify({ ...summary, applied: changed, errors }, null, 2));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
