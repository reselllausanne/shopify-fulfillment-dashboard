import { prisma } from "@/app/lib/prisma";
import { setInventoryQuantity } from "@/shopify/catalog/graphql";
import {
  findShopifyVariantByGtin,
  isRestockDryRun,
  resolveBussignyLocationId,
} from "@/shopify/restock/shopifyRestockInventory";
import { upsertShopifyListingState } from "@/shopify/restock/channelListingState";

/**
 * Phase 2 — cross-channel delist, Shopify leg.
 *
 * When a THE-warehouse item is sold on ANY channel, zero its stock at the
 * Bussigny physical-warehouse location on Shopify. Never deletes or archives
 * products (avoids cold-start recreation and extra API cost).
 *
 * Variant resolution: SupplierVariant.gtin -> Shopify barcode search.
 * Records the outcome in ChannelListingState (channel=SHOPIFY).
 */

export type ShopifyDelistResult = {
  ok: boolean;
  dryRun: boolean;
  processed: Array<{
    providerKey: string;
    gtin: string | null;
    variantId: string | null;
    status: "zeroed" | "dry-run" | "no-gtin" | "not-on-shopify" | "no-inventory-item" | "error";
    detail?: string;
  }>;
  error?: string;
};

/**
 * Zero Bussigny stock on Shopify for sold provider keys.
 * Dry-run by default (SHOPIFY_RESTOCK_DRY_RUN != "0").
 */
export async function delistShopifyByProviderKeys(
  providerKeys: string[],
  options: { dryRun?: boolean } = {}
): Promise<ShopifyDelistResult> {
  const dryRun = options.dryRun ?? isRestockDryRun();
  const processed: ShopifyDelistResult["processed"] = [];

  const keys = Array.from(
    new Set(providerKeys.map((k) => String(k ?? "").trim()).filter(Boolean))
  );
  if (keys.length === 0) {
    return { ok: true, dryRun, processed };
  }

  let locationId: string | null = null;
  try {
    const resolved = await resolveBussignyLocationId();
    locationId = resolved.locationId;
  } catch (error: any) {
    return {
      ok: false,
      dryRun,
      processed,
      error: `Bussigny location resolution failed: ${error?.message ?? error}`,
    };
  }
  if (!locationId) {
    return {
      ok: false,
      dryRun,
      processed,
      error: "Bussigny location not found (set SHOPIFY_BUSSIGNY_LOCATION_ID)",
    };
  }

  const prismaAny = prisma as any;
  const variants: Array<{
    providerKey: string | null;
    supplierVariantId: string | null;
    gtin: string | null;
  }> = await prismaAny.supplierVariant.findMany({
    where: { providerKey: { in: keys } },
    select: { providerKey: true, supplierVariantId: true, gtin: true },
  });
  const byKey = new Map(
    variants.map((v) => [String(v.providerKey ?? "").trim(), v] as const)
  );

  for (const providerKey of keys) {
    const row = byKey.get(providerKey);
    const gtin = String(row?.gtin ?? "").trim() || null;
    if (!gtin) {
      processed.push({ providerKey, gtin: null, variantId: null, status: "no-gtin" });
      continue;
    }

    try {
      const { match, ambiguous } = await findShopifyVariantByGtin(gtin);
      if (!match) {
        processed.push({ providerKey, gtin, variantId: null, status: "not-on-shopify" });
        continue;
      }
      if (!match.inventoryItemId) {
        processed.push({
          providerKey,
          gtin,
          variantId: match.variantId,
          status: "no-inventory-item",
        });
        continue;
      }

      if (dryRun) {
        processed.push({
          providerKey,
          gtin,
          variantId: match.variantId,
          status: "dry-run",
          detail: `[dry-run] would set stock=0 at ${locationId}${ambiguous ? " (ambiguous GTIN)" : ""}`,
        });
        continue;
      }

      await setInventoryQuantity({
        inventoryItemId: match.inventoryItemId,
        locationId,
        quantity: 0,
      });
      await upsertShopifyListingState({
        providerKey,
        supplierVariantId: row?.supplierVariantId ?? null,
        gtin,
        variantId: match.variantId,
        productId: match.productId,
        inventoryItemId: match.inventoryItemId,
        locationId,
        stock: 0,
        status: "SOLD_OUT",
        source: "shopify-delist",
      });
      processed.push({
        providerKey,
        gtin,
        variantId: match.variantId,
        status: "zeroed",
        detail: ambiguous ? "ambiguous GTIN — zeroed first match" : undefined,
      });
    } catch (error: any) {
      processed.push({
        providerKey,
        gtin,
        variantId: null,
        status: "error",
        detail: error?.message ?? String(error),
      });
    }
  }

  const hasError = processed.some((p) => p.status === "error");
  return { ok: !hasError, dryRun, processed };
}
