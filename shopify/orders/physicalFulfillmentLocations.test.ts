import { describe, expect, it } from "vitest";
import { isPhysicalFulfillmentLocationName } from "@/shopify/orders/physicalFulfillmentLocations";

describe("isPhysicalFulfillmentLocationName", () => {
  it("accepts legacy exact Shopify names", () => {
    expect(isPhysicalFulfillmentLocationName("Warehouse Bussigny")).toBe(true);
    expect(isPhysicalFulfillmentLocationName("THE LAB CONCEPT STORE")).toBe(true);
  });

  it("accepts prefixed / renamed Bussigny (sort order in Admin)", () => {
    expect(isPhysicalFulfillmentLocationName("AAAAAAA-Warehouse Bussigny")).toBe(true);
  });

  it("rejects dropship pools", () => {
    expect(isPhysicalFulfillmentLocationName("Chemin de Bas-de-Plan 6")).toBe(false);
    expect(isPhysicalFulfillmentLocationName("Website stock")).toBe(false);
    expect(isPhysicalFulfillmentLocationName("Money Kickz Supplier")).toBe(false);
  });
});
