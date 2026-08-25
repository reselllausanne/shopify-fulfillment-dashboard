/**
 * Repair: unlock dropship Bape tees wrongly locked by broad title match.
 * Keep warehouse retail band (<=120) and registered fixed-price product IDs.
 *
 * Usage: npx tsx scripts/repair-false-bape-fixed-locks.ts
 */
import "dotenv/config";
import { prisma } from "../app/lib/prisma";
import { shopifyGraphQL } from "../lib/shopifyAdmin";
import { findShopifyVariantByGtin } from "../shopify/restock/shopifyRestockInventory";
import { isInStockFixedPriceProduct } from "../shopify/inventory/inStockFixedPrice";

const METAFIELD_SET = /* GraphQL */ `
mutation Unlock($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    userErrors { message }
  }
}
`;

async function main() {
  const rows = await prisma.supplierVariant.findMany({
    where: {
      supplierVariantId: { startsWith: "stx_" },
      manualNote: { startsWith: "in-stock:fixed-price" },
      manualLock: true,
    },
    select: {
      id: true,
      gtin: true,
      manualPrice: true,
      manualNote: true,
      supplierProductName: true,
    },
  });

  let unlocked = 0;
  let kept = 0;
  for (const row of rows) {
    const gtin = String(row.gtin ?? "").trim();
    if (!gtin) continue;
    const { match } = await findShopifyVariantByGtin(gtin);
    const stillFixed =
      match &&
      isInStockFixedPriceProduct({
        sku: match.sku,
        title: match.productTitle,
        productId: match.productId,
      });
    const price = Number(row.manualPrice ?? 0);
    // Keep true warehouse retail locks (boxers/Essentials/Audemars/registered Bape).
    if (stillFixed || (price > 0 && price <= 120 && /bape|boxer|essential|audemars|travis/i.test(String(row.supplierProductName ?? "")))) {
      kept += 1;
      continue;
    }

    await prisma.supplierVariant.update({
      where: { id: row.id },
      data: {
        manualLock: false,
        manualPrice: null,
        manualStock: null,
        manualNote: "phase4:dropship (repair false fixed-price lock)",
        manualUpdatedAt: new Date(),
      },
    });

    if (match?.variantId) {
      await shopifyGraphQL(METAFIELD_SET, {
        metafields: [
          {
            ownerId: match.variantId,
            namespace: "custom",
            key: "price_locked",
            type: "boolean",
            value: "false",
          },
        ],
      });
    }

    unlocked += 1;
    console.log(
      JSON.stringify({
        gtin,
        title: row.supplierProductName,
        was: price,
        action: "unlocked",
      })
    );
  }

  console.log(JSON.stringify({ unlocked, kept, scanned: rows.length }));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
