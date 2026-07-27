/**
 * Set custom.delivery_48h (variant) + custom.soldes_48h (product) for Bussigny stock.
 *
 * Usage:
 *   npx tsx scripts/backfill-bussigny-delivery-48h.ts           # dry-run
 *   npx tsx scripts/backfill-bussigny-delivery-48h.ts --write
 */
import { prisma } from "../app/lib/prisma";
import { convergeVariant } from "../shopify/inventory/convergence";
import { BUSSIGNY_LOCATION_ID } from "../shopify/restock/bussignyDeliveryMetafield";

async function main() {
  const write = process.argv.includes("--write");
  const rows = await prisma.$queryRaw<Array<{ gtin: string; available: number; sku: string | null }>>`
    SELECT DISTINCT ON (s."gtin")
      s."gtin" AS gtin,
      s."available" AS available,
      s."sku" AS sku
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."locationId" = ${BUSSIGNY_LOCATION_ID}
      AND s."sourceType" = 'physical'
      AND s."available" > 0
      AND s."gtin" IS NOT NULL
      AND length(trim(s."gtin")) > 0
    ORDER BY s."gtin", s."priority" ASC, s."updatedAt" DESC
  `;

  console.log(JSON.stringify({ bussignyLocationId: BUSSIGNY_LOCATION_ID, gtins: rows.length, write }, null, 2));

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
