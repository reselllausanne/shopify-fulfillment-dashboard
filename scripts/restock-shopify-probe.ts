#!/usr/bin/env npx tsx
/**
 * Phase 0 restock probe.
 *
 * Validates the Shopify GTIN -> variant -> Bussigny location + sale price
 * foundation WITHOUT writing to the store (dry-run by default).
 *
 * Usage:
 *   npx tsx scripts/restock-shopify-probe.ts <gtin> [quantity] [salePrice]
 *   SHOPIFY_RESTOCK_DRY_RUN=0 npx tsx scripts/restock-shopify-probe.ts <gtin> 1 149.90   # real write
 *
 * Examples:
 *   npx tsx scripts/restock-shopify-probe.ts 1183A872752375           # lookup only
 *   npx tsx scripts/restock-shopify-probe.ts 1183A872752375 1 199.00  # dry-run stock+sale
 */
import {
  resolveBussignyLocationId,
  restockShopifyVariantByGtin,
  isRestockDryRun,
} from "../shopify/restock/shopifyRestockInventory";

async function main() {
  const gtin = process.argv[2];
  const quantity = process.argv[3] ? Number(process.argv[3]) : 1;
  const salePrice = process.argv[4] ? Number(process.argv[4]) : null;

  if (!gtin) {
    console.error("Usage: npx tsx scripts/restock-shopify-probe.ts <gtin> [quantity] [salePrice]");
    process.exitCode = 1;
    return;
  }

  console.log("dry-run:", isRestockDryRun());

  const location = await resolveBussignyLocationId();
  console.log("Bussigny location:", JSON.stringify(location, null, 2));

  const result = await restockShopifyVariantByGtin({
    gtin,
    quantity,
    salePrice,
  });
  console.log("restock result:", JSON.stringify(result, null, 2));

  if (!result.found) {
    console.log("\n=> No variant found. In the real flow this triggers full product creation.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
