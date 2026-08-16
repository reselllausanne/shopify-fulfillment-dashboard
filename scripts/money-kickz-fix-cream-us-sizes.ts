/**
 * Finish YZY YS-01 Cream: US sizes 5-13 @ 79, price lock, MK stock, fix handle.
 * Usage: npx tsx scripts/money-kickz-fix-cream-us-sizes.ts --write
 */
import "dotenv/config";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { setInventoryQuantity } from "@/shopify/catalog/graphql";

const WRITE = process.argv.includes("--write");
const LOCATION_ID = (process.env.SHOPIFY_LOC_MONEY_KICKZ ?? "").trim();
const PRODUCT_ID = "gid://shopify/Product/15342411022722";
const PRICE = "79.00";
const US_SIZES = ["5", "6", "7", "8", "9", "10", "11", "12", "13"];
const BUFFER = 2;
const MAX_PER = 5;
const QTY = Math.min(Math.max(10 - BUFFER, 0), MAX_PER);

async function main() {
  if (!LOCATION_ID) throw new Error("SHOPIFY_LOC_MONEY_KICKZ missing");

  const { data, errors } = await shopifyGraphQL<{
    product: {
      id: string;
      handle: string;
      title: string;
      variants: {
        nodes: Array<{
          id: string;
          price: string;
          selectedOptions: Array<{ name: string; value: string }>;
          inventoryItem: { id: string };
        }>;
      };
    } | null;
  }>(
    `query($id: ID!) {
      product(id: $id) {
        id handle title
        variants(first: 100) {
          nodes {
            id price
            selectedOptions { name value }
            inventoryItem { id }
          }
        }
      }
    }`,
    { id: PRODUCT_ID }
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const product = data?.product;
  if (!product) throw new Error("missing product");

  console.log(product.title, product.handle);

  for (const size of US_SIZES) {
    const variant = product.variants.nodes.find((v) =>
      v.selectedOptions.some((o) => o.value === size)
    );
    if (!variant) {
      console.log("MISSING US", size);
      continue;
    }
    console.log(
      `${WRITE ? "SET" : "WOULD"} US ${size} ${variant.price} -> ${PRICE} mk=${QTY}`
    );
    if (!WRITE) continue;

    await shopifyGraphQL(
      `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          userErrors { message }
        }
      }`,
      {
        productId: PRODUCT_ID,
        variants: [{ id: variant.id, price: PRICE, compareAtPrice: null }],
      }
    );

    await shopifyGraphQL(
      `mutation($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { userErrors { message } }
      }`,
      {
        metafields: [
          {
            ownerId: variant.id,
            namespace: "custom",
            key: "price_locked",
            type: "boolean",
            value: "true",
          },
        ],
      }
    );

    await shopifyGraphQL(
      `mutation($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) {
          userErrors { message }
        }
      }`,
      {
        metafields: [
          { ownerId: variant.id, namespace: "custom", key: "express_price" },
        ],
      }
    );

    await setInventoryQuantity({
      inventoryItemId: variant.inventoryItem.id,
      locationId: LOCATION_ID,
      quantity: QTY,
    });
  }

  if (WRITE && product.handle !== "yzy-ys-01-cream") {
    const upd = await shopifyGraphQL<{
      productUpdate: { product: { handle: string } | null; userErrors: Array<{ message: string }> };
    }>(
      `mutation($input: ProductInput!) {
        productUpdate(input: $input) {
          product { handle }
          userErrors { message }
        }
      }`,
      { input: { id: PRODUCT_ID, handle: "yzy-ys-01-cream", tags: ["jmoney-kicks", "New"], productType: "Sneakers" } }
    );
    console.log(
      "handle",
      upd.data?.productUpdate?.product?.handle,
      upd.data?.productUpdate?.userErrors
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
