import { schedulePostSaleMarketplacePricePush } from "@/inventory/postSaleMarketplacePricePush";
import { findVariantBySku } from "@/shopify/catalog/graphql";
import { getLocationConfig, type LocationConfig } from "@/shopify/inventory/locationConfig";
import { upsertLocationStockRow } from "@/shopify/inventory/locationMirror";
import { refreshAfterShopifySale } from "@/shopify/orders/postSaleRefresh";
import {
  adjustInventoryAtLocation,
  getInventoryAvailableAtLocation,
  getShopifyVariantDetail,
} from "@/shopify/restock/shopifyRestockInventory";
import type { ConsumeLocalStockResult } from "@/shopify/localStock/consumeFromLocalStock";

export type ApplyLocalStockSaleInput = {
  consumed: ConsumeLocalStockResult;
  shopifyLineItemId: string;
};

export type ApplyLocalStockSaleResult = {
  applied: boolean;
  gtin: string | null;
  inventoryDecremented: boolean;
  mirrorUpdated: boolean;
  warnings: string[];
  skipReason?: string;
};

function resolveLocationConfig(consumed: ConsumeLocalStockResult): LocationConfig {
  return (
    getLocationConfig(consumed.locationId) ?? {
      id: consumed.locationId,
      name: consumed.locationName,
      sourceType: "physical",
      priority: 50,
    }
  );
}

/**
 * location, mirror qty, then run post-sale price + marketplace feeds
 * ({@link refreshAfterShopifySale}). Invoked from orders/paid, not save-match.
 */
export async function applyLocalStockSaleSideEffects(
  input: ApplyLocalStockSaleInput
): Promise<ApplyLocalStockSaleResult> {
  const warnings: string[] = [];
  const { consumed, shopifyLineItemId } = input;

  let variantId = String(consumed.shopifyVariantId ?? "").trim();
  let inventoryItemId = String(consumed.inventoryItemId ?? "").trim() || null;
  let sku = String(consumed.sku ?? "").trim() || null;
  let gtin = String(consumed.gtin ?? "").trim() || null;

  if (!variantId || !inventoryItemId) {
    const lookupSku = sku;
    if (lookupSku) {
      const found = await findVariantBySku(lookupSku);
      if (found) {
        variantId = variantId || found.variantId;
        inventoryItemId = inventoryItemId || found.inventoryItemId;
      }
    }
  }

  if (!variantId || !inventoryItemId) {
    return {
      applied: false,
      gtin: null,
      inventoryDecremented: false,
      mirrorUpdated: false,
      warnings,
      skipReason: "no_shopify_variant",
    };
  }

  if (!gtin) {
    const detail = await getShopifyVariantDetail(variantId);
    gtin = String(detail?.barcode ?? "").trim() || null;
  }

  const locationId = consumed.locationId;
  const idempotencyKey = `local-stock-sale:${shopifyLineItemId}:${locationId}`;
  const referenceDocumentUri = `gid://resell-lausanne/LocalStockSale/${shopifyLineItemId}`;

  let inventoryDecremented = false;
  try {
    const current = await getInventoryAvailableAtLocation({
      inventoryItemId,
      locationId,
    });
    if (current == null || current > 0) {
      await adjustInventoryAtLocation({
        inventoryItemId,
        locationId,
        delta: -1,
        idempotencyKey,
        reason: "correction",
        referenceDocumentUri,
      });
      inventoryDecremented = true;
    } else {
      warnings.push("shopify location already at 0");
    }
  } catch (err: any) {
    warnings.push(`shopify decrement: ${err?.message ?? err}`);
  }

  let mirrorUpdated = false;
  const locCfg = resolveLocationConfig(consumed);
  try {
    // Lot consumption is authoritative — mirror must be 0 before any cron/convergence
    // reads stale qty and relists or "corrects" Shopify upward after a local sale.
    await upsertLocationStockRow(locCfg, {
      shopifyVariantId: variantId,
      inventoryItemId,
      sku,
      gtin,
      available: 0,
    });
    mirrorUpdated = true;
  } catch (err: any) {
    warnings.push(`mirror update: ${err?.message ?? err}`);
  }

  if (gtin) {
    try {
      await refreshAfterShopifySale(gtin, {
        forceMarketPrice: true,
        skipInventoryDecrement: true,
        skipDropshipRelist: true,
        variantId,
        lineItemId: shopifyLineItemId,
        soldQty: 1,
      });
    } catch (err: any) {
      warnings.push(`post-sale refresh: ${err?.message ?? err}`);
    }
    schedulePostSaleMarketplacePricePush();
  } else {
    warnings.push("no gtin — skipped price/feed refresh");
  }

  return {
    applied: inventoryDecremented || mirrorUpdated || Boolean(gtin),
    gtin,
    inventoryDecremented,
    mirrorUpdated,
    warnings,
  };
}
