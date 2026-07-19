import { prisma } from "@/app/lib/prisma";
import {
  getInventoryAvailableAtLocation,
  isRestockDryRun,
  resolveBussignyLocationId,
} from "@/shopify/restock/shopifyRestockInventory";
import { upsertShopifyListingState } from "@/shopify/restock/channelListingState";
import {
  createProductFullFlow,
  unlockShopifyPriceByBarcode,
} from "@/shopify/restock/createProductFullFlow";
import { syncChannelsAfterTheSale } from "@/inventory/theSaleChannelSync";

/**
 * Phase 3 — Shopify sold-check cron (runs every ~2 days).
 *
 * Watches ChannelListingState (channel=SHOPIFY, status=ACTIVE) rows created by
 * the restock flow. For each, reads the current Bussigny `available` quantity.
 * When it has dropped to 0, the physical in-hand pair was sold on Shopify:
 *   1. DB SupplierVariant.stock -> 0 (marketplace delist source of truth)
 *   2. syncChannelsAfterTheSale: Decathlon + Galaxus stock=0 + Shopify Bussigny=0
 *   3. unlock `price_locked` metafield (pricing automation resumes)
 *   4. re-upsert the product slug (refresh variants with live pricing)
 *   5. mark listing SOLD_OUT
 *
 * Idempotent and dry-run aware.
 */

export type SoldCheckItemResult = {
  providerKey: string;
  gtin: string | null;
  variantId: string | null;
  available: number | null;
  status: "still-in-stock" | "sold-processed" | "sold-dry-run" | "skipped" | "error";
  detail?: string;
};

export type SoldCheckResult = {
  ok: boolean;
  dryRun: boolean;
  checked: number;
  soldCount: number;
  items: SoldCheckItemResult[];
  error?: string;
};

async function processSold(input: {
  providerKey: string;
  supplierVariantId: string | null;
  gtin: string | null;
  variantId: string | null;
  productId: string | null;
  inventoryItemId: string | null;
  locationId: string;
  origin?: string | null;
}): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const prismaAny = prisma as any;

  // 1. DB stock -> 0 for the real SupplierVariant (if any)
  if (input.supplierVariantId) {
    await prismaAny.supplierVariant
      .update({
        where: { supplierVariantId: input.supplierVariantId },
        data: { stock: 0, manualStock: 0, lastSyncAt: new Date() },
      })
      .catch((err: any) => warnings.push(`DB stock zero failed: ${err?.message ?? err}`));
  }

  // 2. Marketplaces + Shopify Bussigny zero (Decathlon + Galaxus full push)
  const isSynthetic = input.providerKey.startsWith("SHOPIFY_HAND_");
  if (!isSynthetic) {
    const sync = await syncChannelsAfterTheSale({
      providerKeys: [input.providerKey],
      origin: input.origin,
    });
    if (!sync.ok) warnings.push(`Channel sale sync not fully ok: ${sync.error ?? "see logs"}`);
  } else {
    warnings.push("Synthetic providerKey — no SupplierVariant, marketplaces skipped");
  }

  // 3. Unlock price_locked metafield
  if (input.gtin) {
    const unlock = await unlockShopifyPriceByBarcode(input.gtin);
    if (!unlock.ok) warnings.push(`Unlock price_locked failed: ${unlock.error ?? "unknown"}`);
  }

  // 4. Refresh product variants via slug (live pricing, back to dropship listing)
  if (input.gtin) {
    const refresh = await createProductFullFlow(input.gtin);
    if (!refresh.ok) warnings.push(`Slug refresh failed: ${refresh.error ?? "unknown"}`);
  }

  // 5. Mark listing SOLD_OUT
  await upsertShopifyListingState({
    providerKey: input.providerKey,
    supplierVariantId: input.supplierVariantId,
    gtin: input.gtin,
    variantId: input.variantId,
    productId: input.productId,
    inventoryItemId: input.inventoryItemId,
    locationId: input.locationId,
    stock: 0,
    status: "SOLD_OUT",
    source: "shopify-sold-cron",
  });

  return { warnings };
}

export async function runShopifySoldCheck(options: {
  dryRun?: boolean;
  limit?: number;
  origin?: string | null;
} = {}): Promise<SoldCheckResult> {
  const dryRun = options.dryRun ?? isRestockDryRun();
  const items: SoldCheckItemResult[] = [];

  let locationId: string | null = null;
  try {
    locationId = (await resolveBussignyLocationId()).locationId;
  } catch (error: any) {
    return { ok: false, dryRun, checked: 0, soldCount: 0, items, error: error?.message ?? String(error) };
  }
  if (!locationId) {
    return {
      ok: false,
      dryRun,
      checked: 0,
      soldCount: 0,
      items,
      error: "Bussigny location not found",
    };
  }

  const prismaAny = prisma as any;
  const listings: Array<{
    providerKey: string;
    supplierVariantId: string | null;
    gtin: string | null;
    externalVariantId: string | null;
    externalProductId: string | null;
    externalInventoryItemId: string | null;
  }> = await prismaAny.channelListingState.findMany({
    where: {
      channel: "SHOPIFY",
      status: "ACTIVE",
      externalInventoryItemId: { not: null },
    },
    select: {
      providerKey: true,
      supplierVariantId: true,
      gtin: true,
      externalVariantId: true,
      externalProductId: true,
      externalInventoryItemId: true,
    },
    take: options.limit ?? 500,
  });

  let soldCount = 0;
  for (const listing of listings) {
    const inventoryItemId = listing.externalInventoryItemId!;
    try {
      const available = await getInventoryAvailableAtLocation({ inventoryItemId, locationId });
      if (available == null || available > 0) {
        items.push({
          providerKey: listing.providerKey,
          gtin: listing.gtin,
          variantId: listing.externalVariantId,
          available,
          status: "still-in-stock",
        });
        continue;
      }

      // available <= 0 -> sold
      soldCount += 1;
      if (dryRun) {
        items.push({
          providerKey: listing.providerKey,
          gtin: listing.gtin,
          variantId: listing.externalVariantId,
          available,
          status: "sold-dry-run",
          detail: "[dry-run] would delist marketplaces + unlock + refresh slug",
        });
        continue;
      }

      const { warnings } = await processSold({
        providerKey: listing.providerKey,
        supplierVariantId: listing.supplierVariantId,
        gtin: listing.gtin,
        variantId: listing.externalVariantId,
        productId: listing.externalProductId,
        inventoryItemId,
        locationId,
        origin: options.origin,
      });
      items.push({
        providerKey: listing.providerKey,
        gtin: listing.gtin,
        variantId: listing.externalVariantId,
        available,
        status: "sold-processed",
        detail: warnings.length ? warnings.join(" | ") : undefined,
      });
    } catch (error: any) {
      items.push({
        providerKey: listing.providerKey,
        gtin: listing.gtin,
        variantId: listing.externalVariantId,
        available: null,
        status: "error",
        detail: error?.message ?? String(error),
      });
    }
  }

  const hasError = items.some((i) => i.status === "error");
  return { ok: !hasError, dryRun, checked: listings.length, soldCount, items };
}
