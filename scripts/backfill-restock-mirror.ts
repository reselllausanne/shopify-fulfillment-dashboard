/**
 * One-shot: write location mirror from live Shopify + converge for a GTIN.
 * Usage: npx tsx scripts/backfill-restock-mirror.ts <gtin> [locationId]
 */
import { findShopifyVariantByGtin, getInventoryAvailableAtLocation } from "../shopify/restock/shopifyRestockInventory";
import { getLocationConfig } from "../shopify/inventory/locationConfig";
import { upsertLocationStockRow } from "../shopify/inventory/locationMirror";
import { convergeVariant } from "../shopify/inventory/convergence";
import { prisma } from "../app/lib/prisma";

async function main() {
  const gtin = String(process.argv[2] ?? "").trim();
  const locId =
    String(process.argv[3] ?? "").trim() || "gid://shopify/Location/111267971458";
  if (!gtin) throw new Error("usage: backfill-restock-mirror.ts <gtin> [locationId]");

  const { match } = await findShopifyVariantByGtin(gtin);
  if (!match?.inventoryItemId) throw new Error(`No Shopify variant for ${gtin}`);

  const avail = await getInventoryAvailableAtLocation({
    inventoryItemId: match.inventoryItemId,
    locationId: locId,
  });
  console.log({ title: match.productTitle, sku: match.sku, avail, locId });

  const loc = getLocationConfig(locId);
  if (!loc) throw new Error(`Unknown location ${locId}`);

  await upsertLocationStockRow(loc, {
    shopifyVariantId: match.variantId,
    inventoryItemId: match.inventoryItemId,
    sku: match.sku,
    gtin,
    available: avail ?? 0,
  });

  const mirror = await prisma.$queryRaw<
    Array<{ gtin: string; available: number; locationName: string }>
  >`SELECT "gtin", "available", "locationName"
    FROM "public"."ShopifyVariantLocationStock"
    WHERE "gtin" = ${gtin}`;
  console.log("mirror", mirror);

  const stx = await prisma.supplierVariant.findFirst({
    where: { gtin, supplierVariantId: { startsWith: "stx_" } },
    select: {
      supplierVariantId: true,
      manualLock: true,
      manualPrice: true,
      price: true,
    },
  });
  console.log("stx", stx);

  const conv = await convergeVariant(gtin);
  console.log("converge", conv);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
