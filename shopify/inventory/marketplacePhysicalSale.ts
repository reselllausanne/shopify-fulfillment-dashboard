import { getLocationConfig } from "@/shopify/inventory/locationConfig";
import { upsertLocationStockRow } from "@/shopify/inventory/locationMirror";
import {
  isPhysicalMergeEnabled,
  loadPhysicalMirrorLocationRowsByGtin,
} from "@/shopify/inventory/physicalAvailability";
import { convergeVariant, type ConvergeVariantResult } from "@/shopify/inventory/convergence";
import {
  adjustInventoryAtLocation,
  findShopifyVariantByGtin,
  getInventoryAvailableAtLocation,
} from "@/shopify/restock/shopifyRestockInventory";
import type { InventoryChannel } from "@/inventory/types";

const FLAG_ENV = "MARKETPLACE_PHYSICAL_SALE_ROUTING";

export function isMarketplacePhysicalSaleRoutingEnabled(): boolean {
  const explicit = (process.env[FLAG_ENV] ?? "").trim().toLowerCase();
  if (explicit === "0" || explicit === "false" || explicit === "no" || explicit === "off") {
    return false;
  }
  if (explicit === "1" || explicit === "true" || explicit === "yes" || explicit === "on") {
    return true;
  }
  return isPhysicalMergeEnabled();
}

export type MarketplacePhysicalSaleInput = {
  channel: InventoryChannel;
  externalLineId: string;
  externalOrderId?: string | null;
  gtin: string;
  /** Units sold on this marketplace line (positive). */
  quantity: number;
};

export type MarketplacePhysicalSaleResult = {
  routed: boolean;
  decremented: number;
  locations: Array<{ locationId: string; locationName: string; delta: number }>;
  warnings: string[];
  convergence?: ConvergeVariantResult;
  skipReason?: string;
};

/**
 * Phase 4.2 — marketplace sale routing.
 *
 * When Galaxus/Decathlon sells a unit backed by physical mirror stock, decrement
 * Shopify at the highest-priority physical location, refresh the mirror, then
 * converge pricing/state for that GTIN.
 *
 * Idempotent at the order-line level: callers invoke only after
 * `applyInventoryOrderLine` returns `applied: true` (line sync state dedupes).
 */
export async function routeMarketplacePhysicalSale(
  input: MarketplacePhysicalSaleInput
): Promise<MarketplacePhysicalSaleResult> {
  const warnings: string[] = [];
  const locations: MarketplacePhysicalSaleResult["locations"] = [];

  if (!isMarketplacePhysicalSaleRoutingEnabled()) {
    return { routed: false, decremented: 0, locations, warnings, skipReason: "routing_disabled" };
  }

  if (input.channel !== "GALAXUS" && input.channel !== "DECATHLON") {
    return { routed: false, decremented: 0, locations, warnings, skipReason: "not_marketplace" };
  }

  const gtin = String(input.gtin ?? "").trim();
  if (!gtin) {
    return { routed: false, decremented: 0, locations, warnings, skipReason: "empty_gtin" };
  }

  const saleQty = Math.max(0, Math.trunc(input.quantity));
  if (saleQty <= 0) {
    return { routed: false, decremented: 0, locations, warnings, skipReason: "zero_qty" };
  }

  const mirrorRows = await loadPhysicalMirrorLocationRowsByGtin(gtin);
  const totalPhysical = mirrorRows.reduce((sum, row) => sum + row.available, 0);
  if (totalPhysical <= 0) {
    return { routed: false, decremented: 0, locations, warnings, skipReason: "no_physical" };
  }

  let unitsLeft = Math.min(saleQty, totalPhysical);
  let decremented = 0;

  const { match, ambiguous } = await findShopifyVariantByGtin(gtin);
  if (ambiguous) {
    warnings.push("multiple Shopify variants share GTIN — using first match for decrement");
  }
  if (!match?.inventoryItemId) {
    warnings.push("no Shopify inventoryItem for GTIN — cannot decrement physical");
    return { routed: false, decremented: 0, locations, warnings, skipReason: "no_shopify_variant" };
  }

  const inventoryItemId = match.inventoryItemId;
  const variantId = match.variantId;
  const sku = match.sku;

  for (const row of mirrorRows) {
    if (unitsLeft <= 0) break;
    if (row.available <= 0) continue;

    const liveQty = await getInventoryAvailableAtLocation({
      inventoryItemId,
      locationId: row.locationId,
    });
    const available = liveQty != null ? liveQty : row.available;
    if (available <= 0) continue;

    const dec = Math.min(unitsLeft, available, row.available);
    if (dec <= 0) continue;

    const idempotencyKey = `marketplace-sale:${input.channel}:${input.externalLineId}:${row.locationId}`;
    const referenceDocumentUri = `gid://resell-lausanne/MarketplaceSale/${input.channel}/${input.externalLineId}`;

    await adjustInventoryAtLocation({
      inventoryItemId,
      locationId: row.locationId,
      delta: -dec,
      idempotencyKey,
      reason: "correction",
      referenceDocumentUri,
    });

    const availableNow =
      (await getInventoryAvailableAtLocation({
        inventoryItemId,
        locationId: row.locationId,
      })) ?? Math.max(0, available - dec);

    const locCfg = getLocationConfig(row.locationId);
    if (locCfg) {
      try {
        await upsertLocationStockRow(locCfg, {
          shopifyVariantId: variantId,
          inventoryItemId,
          sku,
          gtin,
          available: availableNow,
        });
      } catch (err: any) {
        warnings.push(
          `Mirror update failed for ${row.locationName}: ${err?.message ?? err}`
        );
      }
    }

    locations.push({
      locationId: row.locationId,
      locationName: row.locationName,
      delta: -dec,
    });
    decremented += dec;
    unitsLeft -= dec;
  }

  if (decremented <= 0) {
    return {
      routed: false,
      decremented: 0,
      locations,
      warnings,
      skipReason: "nothing_decremented",
    };
  }

  let convergence: ConvergeVariantResult | undefined;
  try {
    convergence = await convergeVariant(gtin);
    if (convergence.warnings.length) {
      warnings.push(...convergence.warnings.map((w) => `Convergence: ${w}`));
    }
  } catch (err: any) {
    warnings.push(`Convergence failed: ${err?.message ?? err}`);
  }

  return { routed: true, decremented, locations, warnings, convergence };
}
