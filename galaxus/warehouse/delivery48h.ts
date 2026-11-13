import { LOCATIONS } from "@/shopify/inventory/locationConfig";
import { BUSSIGNY_LOCATION_NAME_MATCH } from "@/shopify/orders/physicalFulfillmentLocations";

/** Galaxus stock CSV country. Account warehouse address is Switzerland. */
export const GALAXUS_WAREHOUSE_COUNTRY = "Switzerland";

/** ISO country for the Bussigny route. Stage 1 stock spec wants a 2-letter code. */
export const GALAXUS_WAREHOUSE_COUNTRY_CH = "CH";

/**
 * Partner Portal shipping route for Bussigny (1030) on-hand stock.
 * Delivery time on that route is 2 working days (~48h).
 */
export const GALAXUS_DELIVERY_ROUTE_48H = "7609999696817";

/**
 * Route id for every offer that is not Bussigny on-hand stock. Empty = the
 * default route in the Partner Portal (it has no id; it already holds all
 * offers we have ever sent without a route id). If the portal route gets an id,
 * put it here and every non-Bussigny offer follows.
 */
export const GALAXUS_DEFAULT_DELIVERY_ROUTE_ID = "";

/** Price file column carrying the route per ProviderKey. */
export const GALAXUS_OFFER_ROUTE_HEADER = "DeliveryRouteId";

/**
 * Route id for one offer row. Same Bussigny qty source as the stock file, so
 * price and stock files always agree on the route of a ProviderKey.
 */
export function galaxusDeliveryRouteIdForBussignyQty(bussignyQty: number): string {
  const qty = Math.floor(Number(bussignyQty));
  return Number.isFinite(qty) && qty > 0
    ? GALAXUS_DELIVERY_ROUTE_48H
    : GALAXUS_DEFAULT_DELIVERY_ROUTE_ID;
}

export function bussignyWarehouseLocationId(): string {
  return (
    LOCATIONS.find((location) => location.name === "Warehouse Bussigny")?.id ??
    "gid://shopify/Location/111267971458"
  );
}

export function isGalaxus48hShipLocation(
  input: { locationId?: string | null; locationName?: string | null } | null | undefined
): boolean {
  if (!input) return false;
  const id = String(input.locationId ?? "").trim();
  if (id && id === bussignyWarehouseLocationId()) return true;
  return BUSSIGNY_LOCATION_NAME_MATCH.test(String(input.locationName ?? ""));
}

/**
 * One ProviderKey = one Galaxus offer. Bussigny qty > 0 publishes that qty only
 * on the 48h route. Dropship depth comes back on the next feed once 1030 hits 0.
 */
export function galaxusStockWarehouseFields(bussignyQty: number): {
  warehouseCountry: string;
  warehouseId: string;
  deliveryRouteId: string;
  ship48h: boolean;
  quantity: number | null;
} {
  const qty = Math.floor(Number(bussignyQty));
  const ship48h = Number.isFinite(qty) && qty > 0;
  return {
    warehouseCountry: ship48h ? GALAXUS_WAREHOUSE_COUNTRY_CH : GALAXUS_WAREHOUSE_COUNTRY,
    // WarehouseId is a GLN/postcode per the wiki. Both routes share one warehouse, so blank.
    warehouseId: "",
    deliveryRouteId: galaxusDeliveryRouteIdForBussignyQty(qty),
    ship48h,
    quantity: ship48h ? qty : null,
  };
}
