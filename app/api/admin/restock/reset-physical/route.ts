/**
 * POST /api/admin/restock/reset-physical
 *
 * Bulk reset before a full physical re-scan session:
 *  1. Queries DB mirror for all physical locations with available > 0.
 *  2. Zeroes inventory at those locations via inventorySetQuantities.
 *  3. Unlocks price_locked metafield on those variants (so the pricing cron
 *     resets to normal price; when the operator rescans, liquidation price
 *     will be re-applied with the current formula).
 *
 * Body: { locationIds?: string[], dryRun?: boolean }
 *   locationIds: override list; defaults to all physical locations.
 *   dryRun: true → returns what would change without writing anything.
 *
 * Returns:
 *   { ok, zeroed, unlocked, skipped, dryRun, errors }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { LOCATIONS } from "@/shopify/inventory/locationConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min for large catalogs

const PHYSICAL_LOCATION_IDS = LOCATIONS.filter((l) => l.sourceType === "physical").map(
  (l) => l.id
);

// ---------------------------------------------------------------------------
// GraphQL helpers
// ---------------------------------------------------------------------------

const UNLOCK_METAFIELD_MUTATION = /* GraphQL */ `
mutation ResetPriceLock($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    userErrors { field message }
  }
}`;

const UNSET_COMPARE_AT_MUTATION = /* GraphQL */ `
mutation ResetCompareAt($variants: [ProductVariantsBulkInput!]!, $productId: ID!) {
  productVariantsBulkUpdate(variants: $variants, productId: $productId) {
    userErrors { field message }
  }
}`;

const SET_QUANTITIES = /* GraphQL */ `
mutation ResetPhysicalQty($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    userErrors { field message }
  }
}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function zeroInventoryAtLocation(
  items: Array<{ inventoryItemId: string; locationId: string }>,
  dryRun: boolean
): Promise<{ zeroed: number; errors: string[] }> {
  if (dryRun) return { zeroed: items.length, errors: [] };
  const errors: string[] = [];
  let zeroed = 0;
  for (const batch of chunk(items, 100)) {
    const { data, errors: gqlErrors } = await shopifyGraphQL<{
      inventorySetQuantities: { userErrors: Array<{ message: string }> };
    }>(SET_QUANTITIES, {
      input: {
        reason: "correction",
        name: "available",
        quantities: batch.map((i) => ({
          inventoryItemId: i.inventoryItemId,
          locationId: i.locationId,
          quantity: 0,
        })),
      },
    });
    if (gqlErrors?.length) errors.push(...gqlErrors.map((e) => e.message));
    const ue = data?.inventorySetQuantities?.userErrors ?? [];
    if (ue.length) errors.push(...ue.map((e) => e.message));
    else zeroed += batch.length;
  }
  return { zeroed, errors };
}

async function unlockPriceLocked(
  variantIds: string[],
  dryRun: boolean
): Promise<{ unlocked: number; errors: string[] }> {
  if (dryRun) return { unlocked: variantIds.length, errors: [] };
  const errors: string[] = [];
  let unlocked = 0;
  for (const batch of chunk(variantIds, 25)) {
    const metafields = batch.map((id) => ({
      ownerId: id,
      namespace: "custom",
      key: "price_locked",
      type: "boolean",
      value: "false",
    }));
    const { data, errors: gqlErrors } = await shopifyGraphQL<{
      metafieldsSet: { userErrors: Array<{ message: string }> };
    }>(UNLOCK_METAFIELD_MUTATION, { metafields });
    if (gqlErrors?.length) errors.push(...gqlErrors.map((e) => e.message));
    const ue = data?.metafieldsSet?.userErrors ?? [];
    if (ue.length) errors.push(...ue.map((e) => e.message));
    else unlocked += batch.length;
  }
  return { unlocked, errors };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body?.dryRun === true;
    const requestedLocationIds: string[] = Array.isArray(body?.locationIds)
      ? body.locationIds
      : PHYSICAL_LOCATION_IDS;

    // Validate requested locations are known physical locations
    const validLocationIds = requestedLocationIds.filter((id) =>
      PHYSICAL_LOCATION_IDS.includes(id)
    );
    if (!validLocationIds.length) {
      return NextResponse.json(
        { ok: false, error: "No valid physical location IDs provided" },
        { status: 400 }
      );
    }

    // Query DB mirror for all physical variants with stock > 0
    const rows = await prisma.shopifyVariantLocationStock.findMany({
      where: {
        locationId: { in: validLocationIds },
        available: { gt: 0 },
      },
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

    if (!rows.length) {
      return NextResponse.json({
        ok: true,
        message: "No physical stock found — nothing to reset",
        zeroed: 0,
        unlocked: 0,
        skipped: 0,
        dryRun,
        errors: [],
      });
    }

    // Deduplicate variant IDs for price unlock
    const uniqueVariantIds = [...new Set(rows.map((r) => r.shopifyVariantId))];

    const summary = rows.map((r) => ({
      variantId: r.shopifyVariantId,
      locationId: r.locationId,
      locationName: r.locationName,
      available: r.available,
      gtin: r.gtin,
      sku: r.sku,
    }));

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        message: `Would zero ${rows.length} inventory levels across ${uniqueVariantIds.length} variants at ${validLocationIds.length} location(s). Unlock price_locked on all.`,
        zeroed: rows.length,
        unlocked: uniqueVariantIds.length,
        skipped: 0,
        locations: validLocationIds,
        preview: summary.slice(0, 50),
        totalRows: rows.length,
        errors: [],
      });
    }

    // 1. Zero inventory
    const { zeroed, errors: zeroErrors } = await zeroInventoryAtLocation(
      rows.map((r) => ({ inventoryItemId: r.inventoryItemId, locationId: r.locationId })),
      false
    );

    // 2. Unlock price_locked
    const { unlocked, errors: unlockErrors } = await unlockPriceLocked(uniqueVariantIds, false);

    // 3. Also clear DB manualLock so marketplace won't keep old locked prices
    let dbUnlocked = 0;
    const gtins = rows.map((r) => r.gtin).filter(Boolean) as string[];
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
      dbUnlocked = result.count;
    }

    const allErrors = [...zeroErrors, ...unlockErrors];

    return NextResponse.json({
      ok: allErrors.length === 0,
      dryRun: false,
      zeroed,
      unlocked,
      dbUnlocked,
      skipped: rows.length - zeroed,
      locations: validLocationIds,
      totalRows: rows.length,
      errors: allErrors,
    });
  } catch (err: any) {
    console.error("[ADMIN][RESET-PHYSICAL]", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Reset failed" },
      { status: 500 }
    );
  }
}
