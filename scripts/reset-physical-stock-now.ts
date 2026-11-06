/**
 * ONE-TIME script: zero all physical stock + unlock price_locked + clear DB manualLock.
 * Run: npx tsx scripts/reset-physical-stock-now.ts [--dry-run]
 */
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { LOCATIONS } from "@/shopify/inventory/locationConfig";

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
