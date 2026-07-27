/**
 * Pin custom.soldes_48h definition in Shopify admin + set true on every product
 * with Bussigny mirror stock (uses shopifyVariantId from mirror — no GTIN lookup).
 *
 * Usage:
 *   npx tsx scripts/backfill-bussigny-soldes-48h.ts           # dry-run
 *   npx tsx scripts/backfill-bussigny-soldes-48h.ts --write
 */
import "dotenv/config";
import { prisma } from "../app/lib/prisma";
import { BUSSIGNY_LOCATION_ID } from "../shopify/restock/bussignyDeliveryMetafield";
import {
  ensureSoldes48hMetafieldDefinition,
  readProductSoldes48h,
  resolveProductIdFromVariantId,
  writeProductSoldes48h,
} from "../shopify/restock/bussignySoldesMetafield";

async function main() {
  const write = process.argv.includes("--write");

  const rows = await prisma.$queryRaw<
    Array<{ shopifyVariantId: string; gtin: string | null; sku: string | null; available: number }>
  >`
    SELECT DISTINCT ON (s."shopifyVariantId")
      s."shopifyVariantId" AS "shopifyVariantId",
      s."gtin"             AS gtin,
      s."sku"              AS sku,
      s."available"        AS available
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."locationId" = ${BUSSIGNY_LOCATION_ID}
      AND s."sourceType" = 'physical'
      AND s."available"  > 0
      AND s."shopifyVariantId" IS NOT NULL
      AND length(trim(s."shopifyVariantId")) > 0
    ORDER BY s."shopifyVariantId", s."priority" ASC, s."updatedAt" DESC
  `;

  const def = write ? await ensureSoldes48hMetafieldDefinition() : { ok: true, created: false };
  const productIds = new Map<string, { gtins: Set<string>; skus: Set<string> }>();

  for (const row of rows) {
    const productId = await resolveProductIdFromVariantId(row.shopifyVariantId);
    if (!productId) continue;
    const entry = productIds.get(productId) ?? { gtins: new Set(), skus: new Set() };
    if (row.gtin) entry.gtins.add(row.gtin);
    if (row.sku) entry.skus.add(row.sku);
    productIds.set(productId, entry);
  }

  console.log(
    JSON.stringify(
      {
        bussignyLocationId: BUSSIGNY_LOCATION_ID,
        mirrorVariants: rows.length,
        uniqueProducts: productIds.size,
        definition: def,
        write,
      },
      null,
      2
    )
  );

  if (!write) {
    for (const [productId, meta] of [...productIds.entries()].slice(0, 15)) {
      const gtin = [...meta.gtins][0] ?? "?";
      const sku = [...meta.skus][0] ?? "?";
      console.log(`${productId} | ${gtin} | ${sku}`);
    }
    if (productIds.size > 15) console.log(`... +${productIds.size - 15} more products`);
    return;
  }

  let set = 0;
  let already = 0;
  let errors = 0;

  for (const [productId, meta] of productIds.entries()) {
    try {
      const has = await readProductSoldes48h(productId);
      if (has) {
        already += 1;
        continue;
      }
      await writeProductSoldes48h(productId, true);
      set += 1;
      const gtin = [...meta.gtins][0] ?? "?";
      console.log(`SET ${productId} (${gtin})`);
    } catch (err: any) {
      errors += 1;
      console.error(productId, err?.message ?? err);
    }
  }

  console.log(JSON.stringify({ products: productIds.size, set, already, errors }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
