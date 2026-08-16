import { describe, expect, it } from "vitest";
import { buildPhysicalStockFromFulfillmentOrders } from "@/shopify/inventory/fulfillmentAssignedPhysicalStock";

describe("buildPhysicalStockFromFulfillmentOrders", () => {
  it("marks only the line assigned to Money Kickz supplier as in stock", () => {
    const stock = buildPhysicalStockFromFulfillmentOrders([
      {
        status: "OPEN",
        assignedLocation: {
          location: {
            id: "gid://shopify/Location/111274951042",
            name: "Money Kickz Supplier",
          },
        },
        lineItems: {
          nodes: [
            {
              lineItem: { id: "gid://shopify/LineItem/money-kickz" },
              remainingQuantity: 1,
            },
          ],
        },
      },
      {
        status: "OPEN",
        assignedLocation: {
          location: {
            id: "gid://shopify/Location/72553660705",
            name: "Website stock",
          },
        },
        lineItems: {
          nodes: [
            {
              lineItem: { id: "gid://shopify/LineItem/dropship" },
              remainingQuantity: 1,
            },
          ],
        },
      },
    ]);

    expect(stock.get("gid://shopify/LineItem/money-kickz")).toEqual({
      qty: 1,
      locationName: "Money Kickz Supplier",
      locationId: "gid://shopify/Location/111274951042",
    });
    expect(stock.has("gid://shopify/LineItem/dropship")).toBe(false);
  });
});
