import { describe, expect, it } from "vitest";
import {
  computeLineReturnFee,
  mapShopifyReturnReason,
  normalizeOrderRef,
  orderRefsMatch,
} from "@/shopify/returns/applyReturnToOrderMatch";

describe("applyReturnToOrderMatch helpers", () => {
  it("matches order by name with or without hash", () => {
    const match = {
      shopifyOrderId: "gid://shopify/Order/123",
      shopifyOrderName: "#1042",
    };

    expect(orderRefsMatch(match, "#1042")).toBe(true);
    expect(orderRefsMatch(match, "1042")).toBe(true);
    expect(orderRefsMatch(match, "gid://shopify/Order/123")).toBe(true);
    expect(orderRefsMatch(match, "9999")).toBe(false);
  });

  it("maps Shopify return reasons to dashboard enums", () => {
    expect(mapShopifyReturnReason("WRONG_SIZE")).toBe("STORE_CREDIT");
    expect(mapShopifyReturnReason("EXCHANGE")).toBe("EXCHANGE");
    expect(mapShopifyReturnReason("DAMAGED_ITEM")).toBe("DAMAGE");
  });

  it("uses dynamic restocking fee from line data", () => {
    const result = computeLineReturnFee({
      line: {
        id: "gid://shopify/ReturnLineItem/1",
        title: "Shoe",
        sku: "ABC-42",
        variantTitle: null,
        quantity: 1,
        unitAmount: 189,
        currencyCode: "CHF",
        returnReason: null,
        returnReasonLabel: null,
        customerNote: null,
        restockingFeeAmount: 18.9,
        restockingFeePercent: null,
      },
      fallbackGrossAmount: 189,
    });

    expect(result.feeAmount).toBe(18.9);
    expect(result.feePercent).toBe(10);
  });

  it("normalizes order refs", () => {
    expect(normalizeOrderRef(" #1042 ")).toBe("1042");
  });
});
