import { describe, expect, it } from "vitest";
import { listOpenSiblingLines, listAllOpenUnits } from "./shopifyOrderOpenSiblings";

describe("listOpenSiblingLines", () => {
  const fulfillmentOrders = [
    {
      status: "OPEN",
      lineItems: {
        nodes: [
          { remainingQuantity: 1, variant: { id: "gid://shopify/ProductVariant/1", sku: "A-42" } },
          { remainingQuantity: 1, variant: { id: "gid://shopify/ProductVariant/2", sku: "B-40" } },
        ],
      },
    },
  ];

  const orderLineItems = [
    {
      id: "gid://shopify/LineItem/1",
      title: "Jordan 1",
      variantTitle: "42",
      sku: "A-42",
      variant: { id: "gid://shopify/ProductVariant/1", sku: "A-42" },
    },
    {
      id: "gid://shopify/LineItem/2",
      title: "Dunk Low",
      variantTitle: "40",
      sku: "B-40",
      variant: { id: "gid://shopify/ProductVariant/2", sku: "B-40" },
    },
  ];

  it("returns other open lines excluding the scanned line", () => {
    const siblings = listOpenSiblingLines({
      orderLineItems,
      fulfillmentOrders,
      scannedLineItemId: "gid://shopify/LineItem/1",
    });
    expect(siblings).toHaveLength(1);
    expect(siblings[0]?.title).toBe("Dunk Low");
    expect(siblings[0]?.remainingQuantity).toBe(1);
  });

  it("empty when only the scanned line remains open", () => {
    const singleFo = [
      {
        status: "OPEN",
        lineItems: {
          nodes: [
            { remainingQuantity: 1, variant: { id: "gid://shopify/ProductVariant/1", sku: "A-42" } },
          ],
        },
      },
    ];
    expect(
      listOpenSiblingLines({
        orderLineItems,
        fulfillmentOrders: singleFo,
        scannedLineItemId: "gid://shopify/LineItem/1",
      })
    ).toEqual([]);
  });

  it("ignores already-fulfilled lines", () => {
    const partialFo = [
      {
        status: "OPEN",
        lineItems: {
          nodes: [
            { remainingQuantity: 0, variant: { id: "gid://shopify/ProductVariant/2", sku: "B-40" } },
            { remainingQuantity: 1, variant: { id: "gid://shopify/ProductVariant/1", sku: "A-42" } },
          ],
        },
      },
    ];
    expect(
      listOpenSiblingLines({
        orderLineItems,
        fulfillmentOrders: partialFo,
        scannedLineItemId: "gid://shopify/LineItem/1",
      })
    ).toEqual([]);
  });

  it("listAllOpenUnits includes scanned line for partial then second ship", () => {
    const open = listAllOpenUnits({ orderLineItems, fulfillmentOrders });
    expect(open).toHaveLength(2);
    expect(open.map((l) => l.lineItemId).sort()).toEqual([
      "gid://shopify/LineItem/1",
      "gid://shopify/LineItem/2",
    ]);
  });
});
