/**
 * Lock only registered fixed-price warehouse SKUs (boxers 4-pack + 2 Bape tees).
 * Usage: npx tsx scripts/lock-fixed-price-retail.ts
 */
import "dotenv/config";
import { prisma } from "../app/lib/prisma";
import { convergeVariant } from "../shopify/inventory/convergence";
import { findShopifyVariantByGtin } from "../shopify/restock/shopifyRestockInventory";
import { isInStockFixedPriceProduct } from "../shopify/inventory/inStockFixedPrice";

async function main() {
  const rows = await prisma.$queryRaw<Array<{ gtin: string; name: string | null }>>`
    SELECT DISTINCT sv.gtin, sv."supplierProductName" AS name
    FROM "SupplierVariant" sv
    WHERE sv."supplierVariantId" LIKE 'stx\\_%' ESCAPE '\\'
      AND sv.gtin IS NOT NULL
      AND (
        LOWER(COALESCE(sv."supplierProductName", '')) LIKE '%supreme hanes boxer briefs (4 pack)%'
        OR LOWER(COALESCE(sv."supplierProductName", '')) LIKE '%check by bathing tee%'
        OR LOWER(COALESCE(sv."supplierProductName", '')) LIKE '%big ape head tee white%'
      )
  `;
  console.log("candidate rows", rows.length);

  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const row of rows) {
    try {
      const { match } = await findShopifyVariantByGtin(row.gtin);
      if (
        !match ||
        !isInStockFixedPriceProduct({
          sku: match.sku,
          title: match.productTitle,
          productId: match.productId,
        })
      ) {
        skip += 1;
        continue;
      }
      const res = await convergeVariant(row.gtin);
      console.log(
        JSON.stringify({
          gtin: row.gtin,
          title: match.productTitle,
          before: match.price,
          changed: res.changed,
          changes: res.changes,
        })
      );
      ok += 1;
    } catch (e: any) {
      fail += 1;
      console.error("FAIL", row.gtin, e?.message ?? e);
    }
  }

  console.log(JSON.stringify({ ok, skip, fail }));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
