import { prisma } from "@/app/lib/prisma";

/**
 * Shared ChannelListingState (channel=SHOPIFY) helpers for the restock flow.
 *
 * These rows let the sold-check cron know which Shopify variants hold physical
 * "in-hand" stock at Bussigny so it can detect sales and delist everywhere.
 *
 * providerKey resolution: real SupplierVariant.providerKey when the GTIN maps
 * to one, otherwise a synthetic `SHOPIFY_HAND_{gtin}` (nothing to delist on
 * marketplaces in that case — there is no SupplierVariant).
 */

export function syntheticHandProviderKey(gtin: string): string {
  return `SHOPIFY_HAND_${String(gtin).replace(/\D/g, "")}`;
}

/** Best providerKey for a scanned GTIN: real SupplierVariant first, else synthetic. */
export async function resolveProviderKeyForGtin(gtin: string): Promise<{
  providerKey: string;
  supplierVariantId: string | null;
  synthetic: boolean;
}> {
  const clean = String(gtin ?? "").replace(/\D/g, "").trim();
  const prismaAny = prisma as any;
  if (clean) {
    const row = await prismaAny.supplierVariant.findFirst({
      where: { gtin: clean },
      select: { providerKey: true, supplierVariantId: true },
      orderBy: { updatedAt: "desc" },
    });
    if (row?.providerKey) {
      return {
        providerKey: String(row.providerKey),
        supplierVariantId: row.supplierVariantId ?? null,
        synthetic: false,
      };
    }
  }
  return { providerKey: syntheticHandProviderKey(clean), supplierVariantId: null, synthetic: true };
}

export type ShopifyListingStateInput = {
  providerKey: string;
  supplierVariantId?: string | null;
  gtin: string | null;
  variantId: string | null;
  productId: string | null;
  inventoryItemId: string | null;
  locationId: string | null;
  stock: number;
  status: "ACTIVE" | "SOLD_OUT";
  source: string;
};

export async function upsertShopifyListingState(input: ShopifyListingStateInput): Promise<void> {
  const prismaAny = prisma as any;
  const now = new Date();
  const soldOut = input.status === "SOLD_OUT";
  const common = {
    supplierVariantId: input.supplierVariantId ?? null,
    gtin: input.gtin,
    externalProductId: input.productId,
    externalVariantId: input.variantId,
    externalInventoryItemId: input.inventoryItemId,
    externalLocationId: input.locationId,
    lastPushedStock: input.stock,
    status: input.status,
    soldOutAt: soldOut ? now : null,
    lastSyncedAt: now,
    lastError: null,
    metadataJson: { source: input.source },
  };
  await prismaAny.channelListingState.upsert({
    where: { channel_providerKey: { channel: "SHOPIFY", providerKey: input.providerKey } },
    create: { channel: "SHOPIFY", providerKey: input.providerKey, ...common },
    update: common,
  });
}
