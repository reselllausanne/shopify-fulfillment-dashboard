/**
 * ONE-TIME script: zero all physical stock + unlock price_locked + clear DB manualLock.
 * Also zeros the ShopifyVariantLocationStock DB mirror + clears Google Ads custom_label_0
 * so Google Shopping exclusion takes effect immediately (no need to wait for nightly sync).
 *
 * Run: npx tsx scripts/reset-physical-stock-now.ts [--dry-run]
 */
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { LOCATIONS } from "@/shopify/inventory/locationConfig";
import { syncPhysicalInStockMetafieldForProduct } from "@/shopify/inventory/physicalInStockMetafield";

const DRY_RUN = process.argv.includes("--dry-run");

const PHYSICAL_LOC_IDS = LOCATIONS.filter((l) => l.sourceType === "physical").map((l) => l.id);

const SET_QUANTITIES = /* GraphQL */ `
mutation ResetPhysQty($input: InventorySetQuantitiesInput!, $key: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $key) {
    userErrors { field message }
  }
}`;

const UNLOCK_METAFIELDS = /* GraphQL */ `
mutation UnlockPriceLock($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    userErrors { field message }
  }
}`;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  console.log(`\n=== RESET PHYSICAL STOCK (dryRun=${DRY_RUN}) ===\n`);

  const rows = await prisma.shopifyVariantLocationStock.findMany({
    where: { locationId: { in: PHYSICAL_LOC_IDS }, available: { gt: 0 } },
    select: {
      shopifyVariantId: true,
      inventoryItemId: true,
      locationId: true,
      locationName: true,
      available: true,
      gtin: true,
      sku: true,
    },
  });

  console.log(`Found ${rows.length} rows with stock > 0 across physical locations`);

  const byLoc: Record<string, typeof rows> = {};
  for (const r of rows) {
    (byLoc[r.locationName] ??= []).push(r);
  }
  for (const [loc, rr] of Object.entries(byLoc)) {
    const total = rr.reduce((s, r) => s + r.available, 0);
    console.log(`  ${loc}: ${rr.length} variants, ${total} units`);
  }

  if (!rows.length) {
    console.log("Nothing to reset. Exiting.");
    await prisma.$disconnect();
    return;
  }

  if (DRY_RUN) {
    console.log("\n[DRY-RUN] No changes written. Re-run without --dry-run to execute.");
    await prisma.$disconnect();
    return;
  }

  // 1. Zero inventory
  console.log("\n[1/3] Zeroing inventory...");
  let zeroed = 0;
  const zeroErrors: string[] = [];
  for (let i = 0; i < chunk(rows, 100).length; i++) {
    const batch = chunk(rows, 100)[i];
    const idempotencyKey = `reset-physical-${Date.now()}-${i}`;
    const { data, errors } = await shopifyGraphQL<{
      inventorySetQuantities: { userErrors: Array<{ message: string }> };
    }>(SET_QUANTITIES, {
      input: {
        reason: "correction",
        name: "available",
        quantities: batch.map((r) => ({
          inventoryItemId: r.inventoryItemId,
          locationId: r.locationId,
          quantity: 0,
          changeFromQuantity: r.available,
        })),
      },
      key: idempotencyKey,
    });
    const gqlErr = errors?.length ? errors.map((e) => e.message) : [];
    const ue = data?.inventorySetQuantities?.userErrors ?? [];
    const batchErrors = [...gqlErr, ...ue.map((e) => e.message)];
    if (batchErrors.length) zeroErrors.push(...batchErrors);
    else zeroed += batch.length;
    process.stdout.write(`\r  zeroed ${zeroed}/${rows.length}`);
  }
  console.log(`\n  done. zeroed=${zeroed}, errors=${zeroErrors.length}`);
  if (zeroErrors.length) console.error("  Zero errors:", zeroErrors.slice(0, 5));

  // 2. Unlock price_locked
  console.log("\n[2/3] Unlocking price_locked...");
  const uniqueVariants = [...new Set(rows.map((r) => r.shopifyVariantId))];
  let unlocked = 0;
  const unlockErrors: string[] = [];
  for (const batch of chunk(uniqueVariants, 25)) {
    const { data, errors } = await shopifyGraphQL<{
      metafieldsSet: { userErrors: Array<{ message: string }> };
    }>(UNLOCK_METAFIELDS, {
      metafields: batch.map((id) => ({
        ownerId: id,
        namespace: "custom",
        key: "price_locked",
        type: "boolean",
        value: "false",
      })),
    });
    if (errors?.length) unlockErrors.push(...errors.map((e) => e.message));
    const ue = data?.metafieldsSet?.userErrors ?? [];
    if (ue.length) unlockErrors.push(...ue.map((e) => e.message));
    else unlocked += batch.length;
    process.stdout.write(`\r  unlocked ${unlocked}/${uniqueVariants.length}`);
  }
  console.log(`\n  done. unlocked=${unlocked}, errors=${unlockErrors.length}`);

  // 3. Clear DB manualLock
  console.log("\n[3/3] Clearing DB manualLock...");
  const gtins = rows.map((r) => r.gtin).filter(Boolean) as string[];
  let dbCleared = 0;
  if (gtins.length) {
    const result = await prisma.supplierVariant.updateMany({
      where: {
        gtin: { in: gtins },
        supplierVariantId: { startsWith: "stx_" },
        manualLock: true,
      },
      data: {
        manualLock: false,
        manualPrice: null,
        manualNote: "reset:physical-rescan",
        manualUpdatedAt: new Date(),
      },
    });
    dbCleared = result.count;
  }
  console.log(`  done. dbCleared=${dbCleared}`);

  // 4. Zero DB mirror (ShopifyVariantLocationStock) + clear Google Ads custom_label_0
  //    so Google Shopping exclusion takes effect immediately (no need to wait for nightly sync).
  console.log("\n[4/4] Zeroing DB mirror + clearing Google Ads custom_label_0...");
  {
    // Zero all physical location rows in DB mirror.
    const mirrorResult = await prisma.shopifyVariantLocationStock.updateMany({
      where: { locationId: { in: PHYSICAL_LOC_IDS } },
      data: { available: 0 },
    });
    console.log(`  DB mirror zeroed: ${mirrorResult.count} rows`);

    // Resolve unique product IDs for the variants we just reset.
    // We must do this BEFORE the DB mirror zero (using the in-memory `rows` list)
    // since the DB now shows 0 for all of them.
    const uniqueVariantIds = [...new Set(rows.map((r) => r.shopifyVariantId))];
    const productIds = new Set<string>();
    for (const variantId of uniqueVariantIds) {
      const { data } = await shopifyGraphQL<{
        productVariant: { product: { id: string } | null } | null;
      }>(
        /* GraphQL */ `query ProductOf($id: ID!) { productVariant(id: $id) { product { id } } }`,
        { id: variantId }
      );
      const pid = data?.productVariant?.product?.id;
      if (pid) productIds.add(pid);
    }
    console.log(`  Resolved ${productIds.size} products from ${uniqueVariantIds.length} variants`);

    // Sync each product — with DB mirror at 0, this clears physical_in_stock + custom_label_0.
    let labelCleared = 0;
    let syncErrors = 0;
    for (const productId of productIds) {
      const changes: string[] = [];
      const warnings: string[] = [];
      await syncPhysicalInStockMetafieldForProduct(productId, changes, warnings);
      if (changes.some((c) => c.includes("custom_label_0 cleared"))) labelCleared++;
      if (warnings.length) syncErrors++;
      process.stdout.write(`\r  synced ${labelCleared + syncErrors}/${productIds.size}`);
    }
    console.log(
      `\n  done. labelCleared=${labelCleared} errors=${syncErrors}`
    );
  } // end step 4

  console.log(`\n=== DONE ===`);
  console.log(`  Inventory zeroed: ${zeroed} rows`);
  console.log(`  price_locked unlocked: ${unlocked} variants`);
  console.log(`  DB manualLock cleared: ${dbCleared} rows`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
