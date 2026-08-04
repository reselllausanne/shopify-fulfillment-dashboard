import { prisma } from "../app/lib/prisma";
import { shopifyGraphQL } from "../lib/shopifyAdmin";

const locIds = [
  "gid://shopify/Location/111267250562",
  "gid://shopify/Location/111272100226",
];

const VARIANT_QUERY = /* GraphQL */ `
query VerifyVariant($id: ID!) {
  productVariant(id: $id) {
    id
    sku
    price
    compareAtPrice
    priceLocked: metafield(namespace: "custom", key: "price_locked") { value }
    delivery48h: metafield(namespace: "custom", key: "delivery_48h") { value }
    expressPrice: metafield(namespace: "custom", key: "express_price") { value }
    product { id }
  }
}
`;

async function main() {
  const mirror = await prisma.$queryRaw<
    Array<{ locationName: string; gtin: string; sku: string | null; available: number; shopifyVariantId: string }>
  >`
    SELECT "locationName", "gtin", "sku", "available", "shopifyVariantId"
    FROM "public"."ShopifyVariantLocationStock"
    WHERE "locationId" = ANY(${locIds}::text[]) AND "available" > 0
    ORDER BY "locationName", "gtin"`;

  const byLoc: Record<string, number> = {};
  const issues: string[] = [];
  const galaxusBlockers: string[] = [];
  let liquidationOk = 0;

  for (const row of mirror) {
    byLoc[row.locationName] = (byLoc[row.locationName] ?? 0) + 1;

    const stx = await prisma.supplierVariant.findFirst({
      where: { gtin: row.gtin, supplierVariantId: { startsWith: "stx_" } },
      select: {
        supplierVariantId: true,
        manualLock: true,
        manualPrice: true,
        deliveryType: true,
        stock: true,
        images: true,
        hostedImageUrl: true,
      },
    });

    let shopify: any = null;
    if (row.shopifyVariantId) {
      const { data } = await shopifyGraphQL<{ productVariant: any }>(VARIANT_QUERY, {
        id: row.shopifyVariantId,
      });
      shopify = data?.productVariant;
      await new Promise((r) => setTimeout(r, 150));
    }

    const hasImages =
      (Array.isArray(stx?.images) && stx.images.length > 0) ||
      Boolean(stx?.hostedImageUrl);
    const manualLock = Boolean(stx?.manualLock);
    const manualPrice = stx?.manualPrice != null ? Number(stx.manualPrice) : null;
    const price = shopify?.price != null ? Number(shopify.price) : null;
    const compareAt = shopify?.compareAtPrice != null ? Number(shopify.compareAtPrice) : null;
    const priceLocked = String(shopify?.priceLocked?.value ?? "").toLowerCase() === "true";
    const delivery48h = String(shopify?.delivery48h?.value ?? "").toLowerCase() === "true";
    const onSale = compareAt != null && price != null && compareAt > price;

    const liqOk = manualLock && manualPrice != null && manualPrice > 0 && onSale && priceLocked && delivery48h;
    if (liqOk) liquidationOk += 1;

    const blockers: string[] = [];
    if (!stx) blockers.push("no_stx_row");
    if (!manualLock) blockers.push("no_manualLock");
    if (!manualPrice || manualPrice <= 0) blockers.push("no_manualPrice");
    if (!hasImages) blockers.push("no_images_in_rawJson");
    const dt = String(stx?.deliveryType ?? "");
    if (stx && !dt.startsWith("express_") && dt !== "standard") blockers.push(`deliveryType=${dt}`);
    if (!onSale) blockers.push("shopify_not_on_sale");
    if (!priceLocked) blockers.push("price_locked_false");
    if (!delivery48h) blockers.push("delivery_48h_false");

    if (blockers.length) {
      galaxusBlockers.push(`${row.gtin} (${row.locationName}): ${blockers.join(", ")}`);
    }
    if (!liqOk) {
      issues.push(
        `${row.gtin} lock=${manualLock} mp=${manualPrice} price=${price} compare=${compareAt} 48h=${delivery48h}`
      );
    }
  }

  console.log("Mirror counts:", byLoc);
  console.log("Total stocked rows:", mirror.length);
  console.log("Liquidation lane OK:", liquidationOk, "/", mirror.length);
  if (issues.length) {
    console.log("\nPricing/flag issues (" + issues.length + "):");
    for (const i of issues.slice(0, 30)) console.log(" ", i);
    if (issues.length > 30) console.log(`  ... +${issues.length - 30} more`);
  }
  if (galaxusBlockers.length) {
    console.log("\nGalaxus blockers (" + galaxusBlockers.length + "):");
    for (const b of galaxusBlockers.slice(0, 30)) console.log(" ", b);
    if (galaxusBlockers.length > 30) console.log(`  ... +${galaxusBlockers.length - 30} more`);
  } else {
    console.log("\nAll GTINs Galaxus-eligible (manualLock + price + images + deliveryType)");
  }
}

main().finally(() => prisma.$disconnect());
