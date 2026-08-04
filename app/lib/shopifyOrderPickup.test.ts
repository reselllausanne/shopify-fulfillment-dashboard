import { describe, expect, it } from "vitest";
import { parseShopifyOrderPickup } from "@/app/lib/shopifyOrderPickup";

describe("parseShopifyOrderPickup", () => {
  it("detects pickup from fulfillment assigned location", () => {
    const info = parseShopifyOrderPickup({
      fulfillmentOrders: [
        {
          deliveryMethod: { methodType: "PICK_UP", presentedName: "Retrait en magasin" },
          assignedLocation: {
            name: "Warehouse Bussigny",
            location: {
              id: "gid://shopify/Location/111267971458",
              name: "Warehouse Bussigny",
              address: { address1: "", city: "", zip: "", countryCode: "CH" },
            },
          },
        },
      ],
    });
    expect(info.isStorePickup).toBe(true);
    expect(info.locationName).toBe("Warehouse Bussigny");
    expect(info.locationId).toBe("gid://shopify/Location/111267971458");
    expect(info.label).toContain("Warehouse Bussigny");
  });

  it("detects pickup from shipping line title", () => {
    const info = parseShopifyOrderPickup({
      shippingLines: [{ title: "Retrait · THE LAB CONCEPT STORE", isRemoved: false }],
    });
    expect(info.isStorePickup).toBe(true);
    expect(info.label).toContain("Retrait");
  });

  it("returns false when no pickup signals", () => {
    const info = parseShopifyOrderPickup({
      shippingLines: [{ title: "Swiss Post Standard", isRemoved: false }],
    });
    expect(info.isStorePickup).toBe(false);
  });
});
