import { schedulePostSaleMarketplacePricePush } from "@/inventory/postSaleMarketplacePricePush";
import { loadPhysicalMirrorLocationRowsByGtin } from "@/shopify/inventory/physicalAvailability";
import { getLocationConfig } from "@/shopify/inventory/locationConfig";
import { upsertLocationStockRow } from "@/shopify/inventory/locationMirror";
import { applyLocalStockSaleSideEffects } from "@/shopify/localStock/applyLocalStockSaleSideEffects";
import { tryConsumeLocalStockLot } from "@/shopify/localStock/consumeFromLocalStock";
import { refreshAfterShopifySale } from "@/shopify/orders/postSaleRefresh";
import {
  findShopifyVariantByGtin,
} from "@/shopify/restock/shopifyRestockInventory";

export type ShopifyPaidPhysicalSaleInput = {
  gtin: string;
  sku?: string | null;
  variantId?: string | null;
  lineItemId?: string | null;
  orderId?: string | null;
  quantity?: number;
  /** Line revenue CHF — used for lot margin when a LocalStockLot exists. */
  revenue?: number;
};

export type ShopifyPaidPhysicalSaleResult = {
  isPhysicalStoreSale: boolean;
  lotConsumed: boolean;
  /** When true, caller should not run a second refreshAfterShopifySale pass. */
  refreshAlreadyRan: boolean;
  warnings: string[];
};

function toLineItemGid(lineItemId: string | null | undefined): string | null {
  const raw = String(lineItemId ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("gid://")) return raw;
  return `gid://shopify/LineItem/${raw}`;
}

async function applyPhysicalStoreSaleWithoutLot(input: {
  gtin: string;
  variantId: string | null;
  lineItemGid: string | null;
  soldQty: number;
}): Promise<string[]> {
  const warnings: string[] = [];
  const gtin = String(input.gtin ?? "").trim();
  if (!gtin) return ["empty_gtin"];

  const mirrorRows = await loadPhysicalMirrorLocationRowsByGtin(gtin);
  const stalePhysical = mirrorRows.filter((row) => row.available > 0);
  if (stalePhysical.length === 0) {
    return warnings;
  }

  const preferredVariantId = String(input.variantId ?? "").trim() || null;
  const { match } = await findShopifyVariantByGtin(gtin);
  const variantId = preferredVariantId || match?.variantId || null;
  const inventoryItemId = match?.inventoryItemId || null;
  const sku = match?.sku || null;

  if (!variantId || !inventoryItemId) {
    warnings.push("no_shopify_variant_for_mirror_zero");
    return warnings;
  }

  for (const row of stalePhysical) {
    const locCfg = getLocationConfig(row.locationId);
    if (!locCfg) continue;
    try {
      await upsertLocationStockRow(locCfg, {
        shopifyVariantId: variantId,
        inventoryItemId,
        sku,
        gtin,
        available: 0,
      });
    } catch (err: any) {
      warnings.push(`mirror zero ${row.locationName}: ${err?.message ?? err}`);
    }
  }

  try {
    await refreshAfterShopifySale(gtin, {
      forceMarketPrice: true,
      skipInventoryDecrement: true,
      skipDropshipRelist: true,
      variantId,
      lineItemId: input.lineItemGid,
      soldQty: input.soldQty,
    });
  } catch (err: any) {
    warnings.push(`post-sale refresh: ${err?.message ?? err}`);
  }
  schedulePostSaleMarketplacePricePush();
  return warnings;
}

/**
 * Shopify web store sale (orders/paid): consume local lot when present, zero stale
 * physical mirror, converge price + marketplace feeds — same outcome as Galaxus
 * physical routing but triggered at paid time (not save-match).
 */
export async function processShopifyPaidPhysicalSale(
  input: ShopifyPaidPhysicalSaleInput
): Promise<ShopifyPaidPhysicalSaleResult> {
  const warnings: string[] = [];
  const gtin = String(input.gtin ?? "").trim();
  const sku = String(input.sku ?? "").trim() || null;
  const variantId = String(input.variantId ?? "").trim() || null;
  const lineItemGid = toLineItemGid(input.lineItemId);
  const soldQty = Math.max(1, Math.trunc(input.quantity ?? 1));
  const revenue = Number(input.revenue) || 0;

  if (!gtin) {
    return { isPhysicalStoreSale: false, lotConsumed: false, refreshAlreadyRan: false, warnings: ["empty_gtin"] };
  }

  const mirrorRows = await loadPhysicalMirrorLocationRowsByGtin(gtin);
  const mirrorPhysicalQty = mirrorRows.reduce((sum, row) => sum + row.available, 0);

  let consumed: Awaited<ReturnType<typeof tryConsumeLocalStockLot>> = null;
  try {
    consumed = await tryConsumeLocalStockLot({
      shopifySku: sku,
      shopifyVariantId: variantId,
      revenue,
      quantity: 1,
    });
  } catch (err: any) {
    warnings.push(`lot consume: ${err?.message ?? err}`);
  }

  if (consumed && lineItemGid) {
    const sideEffects = await applyLocalStockSaleSideEffects({
      consumed,
      shopifyLineItemId: lineItemGid,
    });
    if (sideEffects.warnings.length) warnings.push(...sideEffects.warnings);
    return {
      isPhysicalStoreSale: true,
      lotConsumed: true,
      refreshAlreadyRan: true,
      warnings,
    };
  }

  if (mirrorPhysicalQty > 0) {
    const physicalWarnings = await applyPhysicalStoreSaleWithoutLot({
      gtin,
      variantId,
      lineItemGid,
      soldQty,
    });
    warnings.push(...physicalWarnings);
    return {
      isPhysicalStoreSale: true,
      lotConsumed: false,
      refreshAlreadyRan: true,
      warnings,
    };
  }

  return { isPhysicalStoreSale: false, lotConsumed: false, refreshAlreadyRan: false, warnings };
}
