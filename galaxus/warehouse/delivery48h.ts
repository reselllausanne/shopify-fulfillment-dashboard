import { LOCATIONS } from "@/shopify/inventory/locationConfig";
import { BUSSIGNY_LOCATION_NAME_MATCH } from "@/shopify/orders/physicalFulfillmentLocations";

/** Galaxus stock CSV country. Account warehouse address is Switzerland. */
export const GALAXUS_WAREHOUSE_COUNTRY = "Switzerland";

/** ISO country for the Bussigny route. Stage 1 stock spec wants a 2-letter code. */
export const GALAXUS_WAREHOUSE_COUNTRY_CH = "CH";

/**
 * Partner Portal shipping route for Bussigny (1030) on-hand stock.
 * Delivery time on that route is 2 working days (~48h). Empty on every other row
 * so those offers stay on the default route.
 */
export const GALAXUS_DELIVERY_ROUTE_48H = "7609999696817";

/**
 * GLN printed on the route (Chemin de Bas-de-Plan 6). The portal "matching
 * offers" count did not move when WarehouseId was this GLN. It matches the
 * delivery route id itself.
 */
export const GALAXUS_BUSSIGNY_WAREHOUSE_GLN = "7609999696800";

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
    warehouseId: ship48h ? GALAXUS_DELIVERY_ROUTE_48H : "",
    deliveryRouteId: ship48h ? GALAXUS_DELIVERY_ROUTE_48H : "",
    ship48h,
    quantity: ship48h ? qty : null,
  };
}
