import "dotenv/config";
import { findShopifyVariantByGtin } from "../shopify/restock/shopifyRestockInventory";
import { resolvePhysicalRestockPricing } from "../shopify/restock/physicalRestockPricing";
import { shopifyGraphQL } from "../lib/shopifyAdmin";
import { prisma } from "../app/lib/prisma";
import { BUSSIGNY_LOCATION_ID } from "../shopify/restock/bussignyDeliveryMetafield";

const GTIN = process.argv[2] ?? "4550330121471";

const Q = /* GraphQL */ `
query Probe($id: ID!) {
  productVariant(id: $id) {
    id
    title
    price
    compareAtPrice
    barcode
    product {
      handle
      title
      soldes48h: metafield(namespace: "custom", key: "soldes_48h") { value }
    }
    priceLocked: metafield(namespace: "custom", key: "price_locked") { value }
    delivery48h: metafield(namespace: "custom", key: "delivery_48h") { value }
    inventoryItem {
      inventoryLevels(first: 10) {
        nodes {
          location { name }
          quantities(names: ["available"]) { name quantity }
        }
      }
    }
  }
}
`;

async function main() {
  const hit = await findShopifyVariantByGtin(GTIN);
  if (!hit.match) {
    console.log(JSON.stringify({ gtin: GTIN, found: false }, null, 2));
    return;
  }
  const v = hit.match;
  const { data } = await shopifyGraphQL<{ productVariant: Record<string, unknown> | null }>(Q, {
    id: v.variantId,
  });
  const node = data?.productVariant;
  const pricing = await resolvePhysicalRestockPricing(GTIN, {
    slug: v.productHandle,
    sizeEu: v.variantTitle,
  });
  const stx = await prisma.supplierVariant.findFirst({
    where: { gtin: GTIN, supplierVariantId: { startsWith: "stx_" } },
    select: { supplierVariantId: true, manualLock: true, manualPrice: true, price: true },
  });
  const mirror = await prisma.shopifyVariantLocationStock.findFirst({
    where: { gtin: GTIN, locationId: BUSSIGNY_LOCATION_ID, sourceType: "physical" },
    select: { available: true, sku: true },
  });
  console.log(
    JSON.stringify(
      {
        gtin: GTIN,
        found: true,
        handle: (node?.product as any)?.handle,
        size: node?.title,
        shopifyPrice: node?.price,
        compareAt: node?.compareAtPrice,
        price_locked: (node as any)?.priceLocked?.value,
        delivery_48h: (node as any)?.delivery48h?.value,
        soldes_48h: (node?.product as any)?.soldes48h?.value,
        inventory: (node as any)?.inventoryItem?.inventoryLevels?.nodes,
        pricing,
        stx,
        mirror,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
