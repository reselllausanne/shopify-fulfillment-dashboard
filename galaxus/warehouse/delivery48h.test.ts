import { describe, expect, it } from "vitest";
import {
  GALAXUS_48H_ROUTE_ENABLED,
  GALAXUS_WAREHOUSE_COUNTRY_CH,
  GALAXUS_DEFAULT_DELIVERY_ROUTE_ID,
  galaxusDeliveryRouteIdForBussignyQty,
  galaxusStockWarehouseFields,
  isGalaxus48hShipLocation,
} from "@/galaxus/warehouse/delivery48h";

describe("galaxus 48h Bussigny warehouse", () => {
  it("keeps Bussigny qty but does not promise the 48h route while it is off", () => {
    expect(GALAXUS_48H_ROUTE_ENABLED).toBe(false);
    expect(galaxusStockWarehouseFields(2)).toEqual({
      warehouseCountry: GALAXUS_WAREHOUSE_COUNTRY_CH,
      warehouseId: "",
      deliveryRouteId: "",
      ship48h: true,
      quantity: 2,
    });
  });

  it("keeps Switzerland and the default route when Bussigny is empty", () => {
    expect(galaxusStockWarehouseFields(0)).toEqual({
      warehouseCountry: "Switzerland",
      warehouseId: "",
      deliveryRouteId: "",
      ship48h: false,
      quantity: null,
    });
  });

  it("price file route: 48h only for Bussigny qty > 0, default for everything else", () => {
    expect(galaxusDeliveryRouteIdForBussignyQty(1)).toBe(GALAXUS_DEFAULT_DELIVERY_ROUTE_ID);
    expect(galaxusDeliveryRouteIdForBussignyQty(0)).toBe(GALAXUS_DEFAULT_DELIVERY_ROUTE_ID);
    expect(galaxusDeliveryRouteIdForBussignyQty(-3)).toBe(GALAXUS_DEFAULT_DELIVERY_ROUTE_ID);
    expect(galaxusDeliveryRouteIdForBussignyQty(Number.NaN)).toBe(GALAXUS_DEFAULT_DELIVERY_ROUTE_ID);
    expect(galaxusDeliveryRouteIdForBussignyQty(undefined as unknown as number)).toBe(
      GALAXUS_DEFAULT_DELIVERY_ROUTE_ID
    );
  });

  it("flags Bussigny by id or name, not other shops", () => {
    expect(
      isGalaxus48hShipLocation({
        locationId: "gid://shopify/Location/111267971458",
        locationName: "Warehouse Bussigny",
      })
    ).toBe(true);
    expect(isGalaxus48hShipLocation({ locationName: "1 · Warehouse Bussigny" })).toBe(true);
    expect(isGalaxus48hShipLocation({ locationName: "THE LAB CONCEPT STORE" })).toBe(false);
    expect(isGalaxus48hShipLocation(null)).toBe(false);
  });
});
