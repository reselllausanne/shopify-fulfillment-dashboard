/**
 * Restore physical stock from DB mirror values.
 * Run immediately after reset-physical-stock-now.ts to reverse.
 */
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { LOCATIONS } from "@/shopify/inventory/locationConfig";
import crypto from "node:crypto";

const DRY_RUN = process.argv.includes("--dry-run");
const PHYSICAL_LOC_IDS = LOCATIONS.filter((l) => l.sourceType === "physical").map((l) => l.id);

const SET_QUANTITIES = /* GraphQL */ `
mutation RestorePhysQty($input: InventorySetQuantitiesInput!, $key: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $key) {
    userErrors { field message }
  }
}`;

const LOCK_METAFIELDS = /* GraphQL */ `
mutation LockPriceLock($metafields: [MetafieldsSetInput!]!) {
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
  console.log(`\n=== RESTORE PHYSICAL STOCK (dryRun=${DRY_RUN}) ===\n`);

  // Read DB mirror — still has pre-reset values if mirror hasn't synced yet
  const rows = await prisma.shopifyVariantLocationStock.findMany({
    where: {
      locationId: { in: PHYSICAL_LOC_IDS },
      available: { gt: 0 },
    },
    select: {
      shopifyVariantId: true,
      inventoryItemId: true,
      locationId: true,
      locationName: true,
      available: true,
      gtin: true,
    },
  });

  if (!rows.length) {
    console.log("DB mirror already shows 0 everywhere — mirror likely already synced. Cannot restore from DB.");
    console.log("You need to restore from a backup or manually re-enter stock counts.");
    await prisma.$disconnect();
    return;
  }

  console.log(`DB mirror still has ${rows.length} rows with stock > 0:`);
  const byLoc: Record<string, typeof rows> = {};
  for (const r of rows) (byLoc[r.locationName] ??= []).push(r);
  for (const [loc, rr] of Object.entries(byLoc)) {
    console.log(`  ${loc}: ${rr.length} variants, ${rr.reduce((s, r) => s + r.available, 0)} units`);
  }

  if (DRY_RUN) {
    console.log("\n[DRY-RUN] Would restore these quantities. Re-run without --dry-run.");
    await prisma.$disconnect();
    return;
  }

  // 1. Restore inventory quantities
  console.log("\n[1/2] Restoring inventory...");
  let restored = 0;
  const restoreErrors: string[] = [];
  const batches = chunk(rows, 100);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const key = `restore-physical-${crypto.randomBytes(8).toString("hex")}-${i}`;
    const { data, errors } = await shopifyGraphQL<{
      inventorySetQuantities: { userErrors: Array<{ message: string }> };
    }>(SET_QUANTITIES, {
      input: {
        reason: "correction",
        name: "available",
        quantities: batch.map((r) => ({
          inventoryItemId: r.inventoryItemId,
          locationId: r.locationId,
          quantity: r.available, // restore to DB mirror value
          changeFromQuantity: 0,  // we just zeroed everything
        })),
      },
      key,
    });
    const gqlErr = errors?.length ? errors.map((e) => e.message) : [];
    const ue = data?.inventorySetQuantities?.userErrors ?? [];
    const batchErrors = [...gqlErr, ...ue.map((e) => e.message)];
    if (batchErrors.length) restoreErrors.push(...batchErrors);
    else restored += batch.length;
    process.stdout.write(`\r  restored ${restored}/${rows.length}`);
  }
  console.log(`\n  done. restored=${restored}, errors=${restoreErrors.length}`);
  if (restoreErrors.length) console.error("  Errors:", restoreErrors.slice(0, 5));

  // 2. Re-lock price_locked on restored variants
  console.log("\n[2/2] Re-locking price_locked...");
  const uniqueVariants = [...new Set(rows.map((r) => r.shopifyVariantId))];
  let locked = 0;
  const lockErrors: string[] = [];
  for (const batch of chunk(uniqueVariants, 25)) {
    const { data, errors } = await shopifyGraphQL<{
      metafieldsSet: { userErrors: Array<{ message: string }> };
    }>(LOCK_METAFIELDS, {
      metafields: batch.map((id) => ({
        ownerId: id,
        namespace: "custom",
        key: "price_locked",
        type: "boolean",
        value: "true",
      })),
    });
    if (errors?.length) lockErrors.push(...errors.map((e) => e.message));
    const ue = data?.metafieldsSet?.userErrors ?? [];
    if (ue.length) lockErrors.push(...ue.map((e) => e.message));
    else locked += batch.length;
    process.stdout.write(`\r  locked ${locked}/${uniqueVariants.length}`);
  }
  console.log(`\n  done. locked=${locked}, errors=${lockErrors.length}`);

  // 3. Restore DB manualLock
  console.log("\n[3/3] Restoring DB manualLock...");
  // Re-query current Shopify prices to restore manualPrice
  const gtins = rows.map((r) => r.gtin).filter(Boolean) as string[];
  let dbRestored = 0;
  if (gtins.length) {
    // Get current Shopify prices from DB mirror (ChannelListingState has last pushed price)
    const cls = await prisma.channelListingState.findMany({
      where: { gtin: { in: gtins } },
      select: { gtin: true, currentPrice: true },
    });
    const priceByGtin: Record<string, number> = {};
    for (const c of cls) {
      if (c.gtin && c.currentPrice) priceByGtin[c.gtin] = Number(c.currentPrice);
    }

    for (const gtin of gtins) {
      const price = priceByGtin[gtin];
      if (!price) continue;
      const result = await prisma.supplierVariant.updateMany({
        where: {
          gtin,
          supplierVariantId: { startsWith: "stx_" },
          manualLock: false,
          manualNote: "reset:physical-rescan",
        },
        data: {
          manualLock: true,
          manualPrice: price,
          manualNote: "restore:pre-reset",
          manualUpdatedAt: new Date(),
        },
      });
      dbRestored += result.count;
    }
  }
  console.log(`  done. dbRestored=${dbRestored}`);

  console.log(`\n=== RESTORE DONE ===`);
  console.log(`  Stock restored: ${restored}/${rows.length} rows`);
  console.log(`  price_locked re-locked: ${locked} variants`);
  console.log(`  DB manualLock restored: ${dbRestored} rows`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
