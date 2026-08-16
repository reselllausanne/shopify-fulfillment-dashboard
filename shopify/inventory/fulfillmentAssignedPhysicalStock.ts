import {
  getLocationConfig,
  moneyKickzLocationId,
  PHYSICAL_LOCATIONS,
} from "@/shopify/inventory/locationConfig";
import type { OrderLinePhysicalStock } from "@/shopify/inventory/orderLinePhysicalStock.types";

type FoLineNode = {
  remainingQuantity?: number | null;
  totalQuantity?: number | null;
  lineItem?: { id?: string | null } | null;
};

type FoNode = {
  status?: string | null;
  assignedLocation?: {
    name?: string | null;
    location?: { id?: string | null; name?: string | null } | null;
  } | null;
  lineItems?: { nodes?: FoLineNode[] | null } | null;
};

/**
 * Map Shopify lineItemId → physical location from open fulfillment orders.
 * When Shopify commits Lab/Bussigny/etc. or Money Kickz supplier stock to an
 * order, mirror `available` drops to 0 — FO assignedLocation is source of
 * truth for matching UI.
 */
export function buildPhysicalStockFromFulfillmentOrders(
  fulfillmentOrders: FoNode[] | null | undefined
): Map<string, OrderLinePhysicalStock> {
  const out = new Map<string, OrderLinePhysicalStock>();
  for (const fo of fulfillmentOrders ?? []) {
    const status = String(fo.status ?? "").toUpperCase();
    if (status && status !== "OPEN" && status !== "IN_PROGRESS" && status !== "SCHEDULED") {
      continue;
    }
    const locationId = String(fo.assignedLocation?.location?.id ?? "").trim();
    const locationName = String(
      fo.assignedLocation?.location?.name ?? fo.assignedLocation?.name ?? ""
    ).trim();
    const physical = resolvePhysicalLocation(locationId, locationName);
    if (!physical) continue;

    for (const li of fo.lineItems?.nodes ?? []) {
      const lineItemId = String(li.lineItem?.id ?? "").trim();
      if (!lineItemId) continue;
      const qty = Math.max(
        1,
        Number(li.remainingQuantity ?? li.totalQuantity ?? 1) || 1
      );
      // Prefer first physical FO assignment for the line.
      if (!out.has(lineItemId)) {
        out.set(lineItemId, {
          qty,
          locationName: physical.name,
          locationId: physical.id,
        });
      }
    }
  }
  return out;
}

function resolvePhysicalLocation(
  locationId: string,
  locationName: string
): { id: string; name: string } | null {
  if (locationId) {
    const cfg = getLocationConfig(locationId);
    if (cfg?.sourceType === "physical" || cfg?.id === moneyKickzLocationId()) {
      return { id: cfg.id, name: cfg.name };
    }
    return null;
  }
  const name = locationName.toLowerCase();
  if (!name) return null;
  const hit = PHYSICAL_LOCATIONS.find(
    (l) => name.includes(l.name.toLowerCase()) || l.name.toLowerCase().includes(name)
  );
  return hit ? { id: hit.id, name: hit.name } : null;
}

/**
 * @deprecated Do not use for order UI. Mixed orders have multiple FOs; painting
 * every line with the first physical FO location is wrong (e.g. Antica shorts +
 * website sneakers). Prefer `buildPhysicalStockFromFulfillmentOrders` keyed by
 * lineItemId only. Kept for one-off diagnostics.
 */
export function firstPhysicalFulfillmentStock(
  fulfillmentOrders: FoNode[] | null | undefined
): OrderLinePhysicalStock | null {
  for (const fo of fulfillmentOrders ?? []) {
    const status = String(fo.status ?? "").toUpperCase();
    if (status && status !== "OPEN" && status !== "IN_PROGRESS" && status !== "SCHEDULED") {
      continue;
    }
    const locationId = String(fo.assignedLocation?.location?.id ?? "").trim();
    const locationName = String(
      fo.assignedLocation?.location?.name ?? fo.assignedLocation?.name ?? ""
    ).trim();
    const physical = resolvePhysicalLocation(locationId, locationName);
    if (!physical) continue;
    return { qty: 1, locationName: physical.name, locationId: physical.id };
  }
  return null;
}

/**
 * Mirror available>0 wins (in-stock badge). Else FO assignment for that line
 * only — never invent an order-level physical location for unmatched lines.
 */
export function coalescePhysicalStock(
  mirror: OrderLinePhysicalStock | null | undefined,
  fromFulfillment: OrderLinePhysicalStock | null | undefined
): OrderLinePhysicalStock | null {
  if (mirror && mirror.qty > 0) return mirror;
  if (fromFulfillment && fromFulfillment.qty > 0) return fromFulfillment;
  return mirror ?? fromFulfillment ?? null;
}
