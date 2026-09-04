import { describe, expect, it } from "vitest";
import { buildLineItemsByFulfillmentOrder } from "@/lib/shopifyFulfillment";

describe("buildLineItemsByFulfillmentOrder", () => {
  const fulfillmentOrders = [
    {
      id: "fo_1",
      status: "OPEN",
      requestStatus: "UNSUBMITTED",
      supportedActions: [{ action: "CREATE_FULFILLMENT" }],
      lineItems: {
        nodes: [
          {
            id: "fol_1",
            totalQuantity: 3,
            remainingQuantity: 3,
            variant: { id: "variant_1", sku: "SKU-1" },
          },
        ],
      },
    },
  ] as any;

  const orderLineItems = [
    {
      id: "li_1",
      title: "Test Product",
      quantity: 3,
      sku: "SKU-1",
      variantId: "variant_1",
      variantSku: "SKU-1",
    },
  ] as any;

  it("keeps one unit for one scanned item", () => {
    const dbItems = [
      {
        sku: "SKU-1",
        variantId: "variant_1",
        title: "Test Product",
        quantity: 1,
        sourceId: "match_1",
      },
    ] as any;

    const result = buildLineItemsByFulfillmentOrder(fulfillmentOrders, dbItems, orderLineItems);
    const items = result.lineItemsByFulfillmentOrder[0]?.fulfillmentOrderLineItems ?? [];
    const totalQty = items.reduce((sum: number, item: any) => sum + Number(item.quantity ?? 0), 0);

    expect(totalQty).toBe(1);
    expect(items).toHaveLength(1);
  });

  it("keeps unique fulfillment line item ids", () => {
    const dbItems = [
      {
        sku: "SKU-1",
        variantId: "variant_1",
        title: "Test Product",
        quantity: 1,
        sourceId: "match_1",
      },
      {
        sku: "SKU-1",
        variantId: "variant_1",
        title: "Test Product",
        quantity: 1,
        sourceId: "match_2",
      },
    ] as any;

    const result = buildLineItemsByFulfillmentOrder(fulfillmentOrders, dbItems, orderLineItems);
    const items = result.lineItemsByFulfillmentOrder[0]?.fulfillmentOrderLineItems ?? [];

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("fol_1");
    expect(items[0]?.quantity).toBe(2);
  });
});
