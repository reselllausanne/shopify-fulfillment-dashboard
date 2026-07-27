import { describe, expect, it } from "vitest";
import {
  lineItemsFromRawJson,
  mergeReturnLineItemsForStorage,
  normalizeReturnLineItemGid,
} from "@/shopify/returns/returnLineItemsForReceipt";

describe("returnLineItemsForReceipt", () => {
  it("normalizes numeric return line item ids", () => {
    expect(normalizeReturnLineItemGid("123456789")).toBe(
      "gid://shopify/ReturnLineItem/123456789"
    );
  });

  it("reads return line item ids from rawJson", () => {
    const items = lineItemsFromRawJson({
      lineItems: [
        {
          id: "gid://shopify/ReturnLineItem/1",
          quantity: 1,
          sku: "SKU-1",
        },
      ],
    });
    expect(items).toEqual([
      { id: "gid://shopify/ReturnLineItem/1", quantity: 1 },
    ]);
  });

  it("ignores fulfillment-only rows without return line item ids", () => {
    const items = lineItemsFromRawJson({
      lineItems: [
        {
          fulfillmentLineItemId: "gid://shopify/FulfillmentLineItem/9",
          selectedQuantity: 1,
          sku: "SKU-1",
        },
      ],
    });
    expect(items).toEqual([]);
  });

  it("keeps stored return line items when sync payload lacks ids", () => {
    const merged = mergeReturnLineItemsForStorage(
      [
        {
          id: "gid://shopify/ReturnLineItem/1",
          title: "Shoe",
          sku: "SKU-1",
          variantTitle: null,
          quantity: 1,
          unitAmount: 189,
          currencyCode: "CHF",
          returnReason: "OTHER",
          returnReasonLabel: "Other",
          customerNote: null,
          restockingFeePercent: null,
          restockingFeeAmount: null,
        },
      ],
      [
        {
          id: "",
          title: "Shoe",
          sku: "SKU-1",
          variantTitle: null,
          quantity: 1,
          unitAmount: 189,
          currencyCode: "CHF",
          returnReason: "OTHER",
          returnReasonLabel: "Other",
          customerNote: null,
          restockingFeePercent: null,
          restockingFeeAmount: null,
        },
      ]
    );
    expect(merged[0]?.id).toBe("gid://shopify/ReturnLineItem/1");
  });
});
