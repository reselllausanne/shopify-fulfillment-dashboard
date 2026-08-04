/**
 * Backfill custom.physical_in_stock + Google Ads custom_label_0 on every product
 * with mirror physical qty > 0.
 *
 * Shopify automated collection rule (manual one-time in admin):
 *   Product metafield custom.physical_in_stock is true
 *
 * Google Ads / Merchant Center filter:
 *   mm-google-shopping.custom_label_0 = "in_store"
 *   → product group filter when creating Shopping / PMax campaigns
 *
 * Runtime sync (scan / sale / return / mirror):
 *   shopify/inventory/physicalInStockMetafield.ts via locationMirror upserts
 *
 * Usage:
 *   npx tsx scripts/backfill-physical-in-stock-metafield.ts           # dry-run
 *   npx tsx scripts/backfill-physical-in-stock-metafield.ts --write
 */
import {
  ensurePhysicalInStockMetafieldDefinition,
  reconcilePhysicalInStockMetafields,
} from "../shopify/inventory/physicalInStockMetafield";

async function main() {
  const write = process.argv.includes("--write");
  if (write) {
    await ensurePhysicalInStockMetafieldDefinition();
  }
  const result = await reconcilePhysicalInStockMetafields({ dryRun: !write });
  console.log(JSON.stringify({ write, ...result }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
