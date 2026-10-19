/**
 * Market price comparator — read-only scan over the products we actually sell.
 *
 * Pulls live STX Galaxus offers (optionally the best sellers), runs every enabled
 * market source + the demand signal, prints a verdict table, and writes a JSON
 * report under artifacts/market-pricing/. NEVER writes channel prices.
 *
 * Usage:
 *   tsx scripts/market-price-scan.ts --limit 25            # top 25 sellers (30d)
 *   tsx scripts/market-price-scan.ts --gtin 193154407648   # single product
 *   tsx scripts/market-price-scan.ts --limit 50 --min-units 1 --category sneakers
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { calcGalaxusStxSellFromSourceCost } from "@/galaxus/exports/pricing";
import { sourceCostRegistry } from "@/market-pricing/config";
import { analyzeProducts, classifyCategory, type ProductInput } from "@/market-pricing/engine";
import { floorInclFromExVatSell } from "@/market-pricing/verdict";
import type { SalesCategory } from "@/market-pricing/types";

type Args = {
  limit: number;
  minUnits: number;
  gtin: string | null;
  category: SalesCategory | null;
};

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  return {
    limit: Number(get("--limit") ?? 25),
    minUnits: Number(get("--min-units") ?? 0),
    gtin: get("--gtin"),
    category: (get("--category") as SalesCategory | null) ?? null,
  };
}

type Candidate = {
  gtin: string;
  title: string | null;
  brand: string | null;
  cost_ex_vat: number;
  units_30d: number;
};

async function loadCandidates(args: Args): Promise<Candidate[]> {
  if (args.gtin) {
    const rows = await prisma.$queryRaw<Candidate[]>(Prisma.sql`
      SELECT sv."gtin",
             sv."supplierProductName" AS title,
             sv."supplierBrand" AS brand,
             sv."price"::float AS cost_ex_vat,
             0 AS units_30d
      FROM "public"."SupplierVariant" sv
      WHERE sv."gtin" = ${args.gtin}
        AND sv."supplierVariantId" ~* '^stx'
      LIMIT 1
    `);
    return rows;
  }

  // Best sellers over the last 30 days among live STX offers.
  return prisma.$queryRaw<Candidate[]>(Prisma.sql`
    WITH sales AS (
      SELECT m."galaxusGtin" AS gtin, COUNT(*)::int AS units_30d
      FROM "public"."GalaxusStockxMatch" m
      JOIN "public"."GalaxusOrder" o ON o."id" = m."galaxusOrderId"
      WHERE o."cancelledAt" IS NULL
        AND o."orderDate" >= now() - interval '30 days'
        AND m."galaxusGtin" IS NOT NULL
      GROUP BY 1
    )
    SELECT sv."gtin",
           sv."supplierProductName" AS title,
           sv."supplierBrand" AS brand,
           sv."price"::float AS cost_ex_vat,
           COALESCE(s.units_30d, 0) AS units_30d
    FROM "public"."SupplierVariant" sv
    LEFT JOIN sales s ON s.gtin = sv."gtin"
    WHERE sv."supplierVariantId" ~* '^stx'
      AND sv."stock" > 0
      AND sv."gtin" IS NOT NULL
      AND COALESCE(s.units_30d, 0) >= ${args.minUnits}
    ORDER BY COALESCE(s.units_30d, 0) DESC, sv."price" DESC
    LIMIT ${args.limit}
  `);
}

function pad(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
}

function fmt(n: number | null, dp = 0): string {
  return n == null ? "—" : n.toFixed(dp);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log("\n=== Market price comparator — enabled sources ===");
  for (const s of sourceCostRegistry()) {
    console.log(
      `  [${s.enabled ? "ON " : "off"}] ${pad(s.label, 42)} ${s.monthlyChf ? `CHF ${s.monthlyChf}/mo` : "free"}`
    );
  }

  const candidates = (await loadCandidates(args)).filter(
    (c) => !args.category || classifyCategory({ title: c.title, brand: c.brand }) === args.category
  );
  if (candidates.length === 0) {
    console.log("\nNo candidates matched. Check --gtin / --min-units / --category.");
    return;
  }
  console.log(`\nAnalyzing ${candidates.length} product(s)…\n`);

  const inputs: ProductInput[] = candidates.map((c) => {
    const floorExVat = calcGalaxusStxSellFromSourceCost(c.cost_ex_vat);
    const ourPriceInclChf = floorInclFromExVatSell(floorExVat); // we list STX at the locked floor
    return {
      gtin: c.gtin,
      title: c.title,
      brand: c.brand,
      supplierCostExVatChf: c.cost_ex_vat,
      ourPriceInclChf,
      ourUnits30d: c.units_30d,
    };
  });

  const snapshots = await analyzeProducts(inputs, 3);

  console.log(
    `${pad("Product", 34)} ${pad("30d", 4)} ${pad("Our", 7)} ${pad("Mkt med", 8)} ` +
      `${pad("Cheapest", 9)} ${pad("Shops", 6)} ${pad("SoldOut", 8)} ${pad("Trend", 6)} Verdict`
  );
  console.log("-".repeat(120));
  for (const s of snapshots) {
    console.log(
      `${pad(s.title ?? s.gtin, 34)} ${pad(String(s.demand.ourUnits30d ?? 0), 4)} ` +
        `${pad(fmt(s.verdict.ourPriceChf, 0), 7)} ${pad(fmt(s.medianChf, 0), 8)} ` +
        `${pad(fmt(s.minChf, 0), 9)} ${pad(fmt(s.rivalShopCount, 0), 6)} ` +
        `${pad(s.soldOutRatio == null ? "—" : `${Math.round(s.soldOutRatio * 100)}%`, 8)} ` +
        `${pad(s.demand.trendsIndex == null ? "—" : String(s.demand.trendsIndex), 6)} ` +
        `${s.verdict.code}${s.verdict.suggestedPriceChf != null ? ` → ${s.verdict.suggestedPriceChf.toFixed(2)}` : ""}`
    );
  }

  const outDir = path.join(process.cwd(), "artifacts", "market-pricing");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `scan-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify({ generatedAt: new Date().toISOString(), args, snapshots }, null, 2) + "\n",
    "utf8"
  );
  console.log(`\nReport written: ${path.relative(process.cwd(), outFile)}`);

  const actionable = snapshots.filter(
    (s) => s.verdict.code === "CUT_TO_MARKET" || s.verdict.code === "RAISE"
  );
  console.log(
    `\nSummary: ${snapshots.length} scanned · ${actionable.length} actionable · ` +
      `${snapshots.filter((s) => s.verdict.code === "BELOW_FLOOR_RISK").length} below-floor · ` +
      `${snapshots.filter((s) => s.verdict.code === "NO_MARKET_DATA").length} no-data`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
