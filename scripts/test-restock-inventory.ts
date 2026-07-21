/**
 * Live smoke test for Admin API 2026-07 inventory mutations used by /restock.
 * +1 then -1 at Bussigny so net stock unchanged.
 *
 * Usage:
 *   SHOPIFY_RESTOCK_DRY_RUN=0 npx tsx scripts/test-restock-inventory.ts [gtin]
 */
import {
  activateInventoryAtLocation,
  adjustInventoryAtLocation,
  findShopifyVariantByGtin,
  getInventoryAvailableAtLocation,
  resolvePhysicalLocationId,
} from "../shopify/restock/shopifyRestockInventory";

async function main() {
  const gtin = String(process.argv[2] ?? "197615251573").trim();
  console.log(`[test] gtin=${gtin} api=${process.env.API_VERSION_SHOPIFY ?? "default"}`);

  const { match } = await findShopifyVariantByGtin(gtin);
  if (!match?.inventoryItemId) {
    throw new Error(`No Shopify variant/inventoryItem for GTIN ${gtin}`);
  }
  console.log(`[test] variant=${match.variantId} title=${match.productTitle}`);

  const { locationId, name } = await resolvePhysicalLocationId(
    process.env.SHOPIFY_LOC_BUSSIGNY ?? "gid://shopify/Location/111267971458"
  );
  if (!locationId) throw new Error("Bussigny location unresolved");
  console.log(`[test] location=${name ?? locationId}`);

  const before = await getInventoryAvailableAtLocation({
    inventoryItemId: match.inventoryItemId,
    locationId,
  });
  console.log(`[test] available before=${before}`);

  await activateInventoryAtLocation({
    inventoryItemId: match.inventoryItemId,
    locationId,
  });
  console.log("[test] activate OK");

  await adjustInventoryAtLocation({
    inventoryItemId: match.inventoryItemId,
    locationId,
    delta: 1,
  });
  const mid = await getInventoryAvailableAtLocation({
    inventoryItemId: match.inventoryItemId,
    locationId,
  });
  console.log(`[test] after +1 available=${mid}`);
  if (mid == null || (before != null && mid !== before + 1)) {
    throw new Error(`+1 failed: before=${before} mid=${mid}`);
  }

  await adjustInventoryAtLocation({
    inventoryItemId: match.inventoryItemId,
    locationId,
    delta: -1,
  });
  const after = await getInventoryAvailableAtLocation({
    inventoryItemId: match.inventoryItemId,
    locationId,
  });
  console.log(`[test] after -1 available=${after}`);
  if (after !== before) {
    throw new Error(`restore failed: before=${before} after=${after}`);
  }

  console.log("[test] PASS — activate/adjust/CAS restore OK");
}

main().catch((err) => {
  console.error("[test] FAIL", err?.message ?? err);
  process.exit(1);
});
