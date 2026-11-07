/**
 * Fix double stock at Bussigny after restore+scan incident.
 *
 * Context: restore script set stock back to DB mirror values, then user scanned
 * ~500 pairs → any variant that had qty>=2 AND liquidation/solde pricing got doubled.
 * This script reduces those back to 1 (keeps the physically scanned unit).
 *
 * Liquidation detection: price_locked=true metafield OR compareAtPrice > price * 1.1
 *
 * Usage:
 *   npx tsx scripts/fix-double-stock-bussigny.ts            # dry-run (default)
 *   npx tsx scripts/fix-double-stock-bussigny.ts --execute  # live
 */

import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import crypto from "node:crypto";

const BUSSIGNY_LOCATION_ID = "gid://shopify/Location/111267971458";
const DRY_RUN = !process.argv.includes("--execute");

const VARIANT_DETAIL_QUERY = /* GraphQL */ `
query FixDblDetail($id: ID!) {
  productVariant(id: $id) {
    id
    sku
    price
    compareAtPrice
    metafield(namespace: "custom", key: "price_locked") { value }
    product { title }
  }
}
`;

const SET_QUANTITIES_MUTATION = /* GraphQL */ `
mutation FixDblSetQty($input: InventorySetQuantitiesInput!, $key: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $key) {
    userErrors { field message }
  }
}
`;

type VariantDetail = {
  id: string;
  sku: string | null;
  price: string | null;
  compareAtPrice: string | null;
  metafield: { value: string } | null;
  product: { title: string } | null;
};

async function main() {
  console.log(`\n=== FIX DOUBLE STOCK BUSSIGNY (dryRun=${DRY_RUN}) ===\n`);

  if (DRY_RUN) {
    console.log("Pass --execute to apply changes.\n");
  }

  // 1. Fetch all variants with available >= 2 at Bussigny
  const rows = await prisma.shopifyVariantLocationStock.findMany({
    where: {
      locationId: BUSSIGNY_LOCATION_ID,
      available: { gte: 2 },
    },
    select: {
      shopifyVariantId: true,
      inventoryItemId: true,
      sku: true,
      gtin: true,
      available: true,
    },
    orderBy: { available: "desc" },
  });

  console.log(`Found ${rows.length} variants with available >= 2 at Bussigny\n`);

  if (rows.length === 0) {
    console.log("Nothing to fix.");
    await prisma.$disconnect();
    return;
  }

  // 2. For each, check Shopify for liquidation pricing
  const toFix: Array<{
    shopifyVariantId: string;
    inventoryItemId: string;
    sku: string | null;
    gtin: string | null;
    available: number;
    title: string | null;
    price: number | null;
    compareAtPrice: number | null;
    priceLocked: boolean;
  }> = [];

  let checked = 0;
  const fetchErrors: string[] = [];

  for (const row of rows) {
    checked++;
    if (checked % 25 === 0) process.stdout.write(`\r  Checking ${checked}/${rows.length}...`);

    const { data, errors: gqlErrors } = await shopifyGraphQL<{
      productVariant: VariantDetail | null;
    }>(VARIANT_DETAIL_QUERY, { id: row.shopifyVariantId });

    if (gqlErrors?.length) {
      fetchErrors.push(`${row.shopifyVariantId}: ${gqlErrors.map((e) => e.message).join("; ")}`);
      continue;
    }

    const v = data?.productVariant;
    if (!v) {
      fetchErrors.push(`${row.shopifyVariantId}: not found in Shopify`);
      continue;
    }

    const price = v.price ? Number(v.price) : null;
    const compareAtPrice = v.compareAtPrice ? Number(v.compareAtPrice) : null;
    const priceLocked = String(v.metafield?.value ?? "").toLowerCase() === "true";

    // Liquidation: explicitly locked OR compareAt significantly above price (>10%)
    const isLiquidation =
      priceLocked ||
      (price != null && compareAtPrice != null && compareAtPrice > price * 1.1);

    if (!isLiquidation) continue;

    toFix.push({
      shopifyVariantId: row.shopifyVariantId,
      inventoryItemId: row.inventoryItemId,
      sku: row.sku ?? v.sku ?? null,
      gtin: row.gtin,
      available: row.available,
      title: v.product?.title ?? null,
      price,
      compareAtPrice,
      priceLocked,
    });
  }

  console.log(`\n\nLiquidation variants with double stock: ${toFix.length}\n`);

  if (toFix.length === 0) {
    console.log("Nothing to fix.");
    if (fetchErrors.length) console.error(`\nFetch errors:\n${fetchErrors.join("\n")}`);
    await prisma.$disconnect();
    return;
  }

  // 3. Print what we'd do
  console.log("Variants to reduce (available → available-1):\n");
  for (const item of toFix) {
    const badge = item.priceLocked ? "🔒 locked" : `💸 compareAt=${item.compareAtPrice}`;
    console.log(
      `  ${item.title ?? "?"} | SKU=${item.sku ?? "?"} | GTIN=${item.gtin ?? "?"} | ${item.available} → ${item.available - 1} | price=${item.price} [${badge}]`
    );
  }

  if (DRY_RUN) {
    console.log(`\n[DRY-RUN] ${toFix.length} variants would be reduced. Run with --execute to apply.`);
    if (fetchErrors.length) console.error(`\nFetch errors (${fetchErrors.length}):\n${fetchErrors.join("\n")}`);
    await prisma.$disconnect();
    return;
  }

  // 4. Apply reductions one by one (idempotent)
  console.log("\nApplying reductions...\n");
  let reduced = 0;
  const applyErrors: string[] = [];

  for (const item of toFix) {
    const key = `fix-dbl-bussigny-${item.shopifyVariantId.replace(/\//g, "-")}-${crypto.randomBytes(6).toString("hex")}`;

    const { data: setData, errors: setErrors } = await shopifyGraphQL<{
      inventorySetQuantities: { userErrors: Array<{ field: string; message: string }> };
    }>(SET_QUANTITIES_MUTATION, {
      input: {
        reason: "correction",
        name: "available",
        quantities: [
          {
            inventoryItemId: item.inventoryItemId,
            locationId: BUSSIGNY_LOCATION_ID,
            quantity: item.available - 1,
            changeFromQuantity: item.available,
          },
        ],
      },
      key,
    });

    if (setErrors?.length) {
      const msg = setErrors.map((e) => e.message).join("; ");
      applyErrors.push(`${item.shopifyVariantId} (${item.sku ?? "?"}): ${msg}`);
      console.log(`  ✗ ${item.title ?? item.sku ?? "?"}: ${msg}`);
      continue;
    }

    const ue = setData?.inventorySetQuantities?.userErrors ?? [];
    if (ue.length) {
      const msg = ue.map((e) => e.message).join("; ");
      applyErrors.push(`${item.shopifyVariantId} (${item.sku ?? "?"}): ${msg}`);
      console.log(`  ✗ ${item.title ?? item.sku ?? "?"}: ${msg}`);
      continue;
    }

    reduced++;
    console.log(
      `  ✓ ${item.title ?? "?"} | SKU=${item.sku ?? "?"} | GTIN=${item.gtin ?? "?"} | ${item.available} → ${item.available - 1}`
    );
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total with available >= 2: ${rows.length}`);
  console.log(`Identified as liquidation: ${toFix.length}`);
  console.log(`Successfully reduced: ${reduced}`);
  if (applyErrors.length) {
    console.error(`\nApply errors (${applyErrors.length}):`);
    applyErrors.forEach((e) => console.error(`  ${e}`));
  }
  if (fetchErrors.length) {
    console.error(`\nFetch errors (${fetchErrors.length}):`);
    fetchErrors.forEach((e) => console.error(`  ${e}`));
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
