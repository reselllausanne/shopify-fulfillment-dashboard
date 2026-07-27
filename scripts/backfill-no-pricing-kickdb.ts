/**
 * Backfill liquidation pricing for GTINs listed in no-pricing CSV.
 * Uses KickDB live via Shopify handle + full identifier match.
 *
 * Usage:
 *   npx tsx scripts/backfill-no-pricing-kickdb.ts
 *   npx tsx scripts/backfill-no-pricing-kickdb.ts --write
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { convergeVariant } from "../shopify/inventory/convergence";
import { resolvePhysicalRestockPricing } from "../shopify/restock/physicalRestockPricing";
import { prisma } from "../app/lib/prisma";

const CSV_PATH = path.join(process.cwd(), "artifacts/no-pricing-physical-stock-40.csv");

function parseGtins(csv: string): string[] {
  return csv
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(",")[0]?.trim())
    .filter(Boolean);
}

async function main() {
  const write = process.argv.includes("--write");
  const gtins = parseGtins(fs.readFileSync(CSV_PATH, "utf8"));
  let canPrice = 0;
  let fixed = 0;
  let stillNone = 0;
  let errors = 0;

  console.log(JSON.stringify({ gtins: gtins.length, write }, null, 2));

  for (const gtin of gtins) {
    const pricing = await resolvePhysicalRestockPricing(gtin);
    const hasPricing = Boolean(pricing.sellPrice && pricing.compareAt);
    if (hasPricing) canPrice += 1;
    else stillNone += 1;

    console.log(
      [
        gtin,
        hasPricing ? "CAN_PRICE" : "NO_PRICE",
        pricing.source,
        hasPricing ? `sell=${pricing.sellPrice} compare=${pricing.compareAt}` : "",
      ]
        .filter(Boolean)
        .join(" | ")
    );

    if (!write || !hasPricing) continue;

    try {
      const res = await convergeVariant(gtin);
      if (res.changed) fixed += 1;
      if (res.error) {
        errors += 1;
        console.error("  error:", res.error);
      }
    } catch (err: any) {
      errors += 1;
      console.error("  error:", err?.message ?? err);
    }
  }

  console.log(
    JSON.stringify({ scanned: gtins.length, canPrice, fixed, stillNone, errors, write }, null, 2)
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
