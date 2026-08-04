/**
 * Backfill custom.express_price = liquidation price + 20 CHF for warehouse stock.
 *
 * Runs convergeVariant per GTIN (liquidation lane qty > 0) so price, flags, and
 * express metafield stay aligned.
 *
 * Usage:
 *   npx tsx scripts/backfill-liquidation-express-price.ts           # dry-run
 *   npx tsx scripts/backfill-liquidation-express-price.ts --write
 */
import { prisma } from "../app/lib/prisma";
import { convergeVariant } from "../shopify/inventory/convergence";
import { LIQUIDATION_LOCATION_IDS } from "../shopify/inventory/locationConfig";
import { readLiquidationExpressSurchargeChf } from "../shopify/restock/liquidationExpressPrice";

async function main() {
  const write = process.argv.includes("--write");
  const rows = await prisma.$queryRaw<Array<{ gtin: string; available: number; sku: string | null }>>`
    SELECT
      s."gtin" AS gtin,
      SUM(s."available")::int AS available,
      MAX(s."sku") AS sku
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."locationId" = ANY(${LIQUIDATION_LOCATION_IDS}::text[])
      AND s."sourceType" = 'physical'
      AND s."available" > 0
      AND s."gtin" IS NOT NULL
      AND length(trim(s."gtin")) > 0
    GROUP BY s."gtin"
    ORDER BY s."gtin"
  `;

  console.log(
    JSON.stringify(
      {
        liquidationLocations: LIQUIDATION_LOCATION_IDS,
        gtins: rows.length,
        expressSurchargeChf: readLiquidationExpressSurchargeChf(),
        write,
      },
      null,
      2
    )
  );

  if (!write) {
    for (const r of rows.slice(0, 20)) {
      console.log(`${r.gtin} | ${r.sku ?? "?"} | qty=${r.available}`);
    }
    if (rows.length > 20) console.log(`... +${rows.length - 20} more`);
    return;
  }

  let changed = 0;
  let errors = 0;
  for (const r of rows) {
    try {
      const res = await convergeVariant(r.gtin);
      if (res.changed) changed += 1;
      if (res.error) {
        errors += 1;
        console.error(r.gtin, res.error);
      } else if (res.changed) {
        console.log(r.gtin, res.changes.join("; "));
      }
    } catch (err: any) {
      errors += 1;
      console.error(r.gtin, err?.message ?? err);
    }
  }
  console.log(JSON.stringify({ scanned: rows.length, changed, errors }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
