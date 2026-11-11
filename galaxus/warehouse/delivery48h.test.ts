import { describe, expect, it } from "vitest";
import {
  GALAXUS_DELIVERY_ROUTE_48H,
  GALAXUS_WAREHOUSE_COUNTRY,
  galaxusStockWarehouseFields,
  isGalaxus48hShipLocation,
} from "@/galaxus/warehouse/delivery48h";

describe("galaxus 48h Bussigny warehouse", () => {
  it("puts on-hand Bussigny qty on the 48h route and Switzerland", () => {
    expect(galaxusStockWarehouseFields(2)).toEqual({
      warehouseCountry: GALAXUS_WAREHOUSE_COUNTRY,
      deliveryRouteId: GALAXUS_DELIVERY_ROUTE_48H,
      ship48h: true,
      quantity: 2,
    });
  });

  it("keeps Switzerland and the default route when Bussigny is empty", () => {
    expect(galaxusStockWarehouseFields(0)).toEqual({
      warehouseCountry: "Switzerland",
      deliveryRouteId: "",
      ship48h: false,
      quantity: null,
    });
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
