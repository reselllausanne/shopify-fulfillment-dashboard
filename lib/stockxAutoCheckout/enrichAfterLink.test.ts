import { describe, expect, it } from "vitest";
import { buildOrderMatchEnrichPatchFromStockx } from "@/lib/stockxAutoCheckout/enrichAfterLink";
import { synthesizeBuyOrderDetailsFromListNode } from "@/galaxus/stx/stockxClient";

describe("buildOrderMatchEnrichPatchFromStockx", () => {
  it("fills chainId + orderId from order number resolve snapshot", () => {
    const listNode = {
      chainId: "chain-abc",
      orderId: "order-xyz",
      orderNumber: "03-2GJ0J7WHDV",
      amount: 120.5,
      currencyCode: "CHF",
      purchaseDate: "2026-10-20T10:00:00Z",
      state: { statusKey: "ORDERED" },
      checkoutType: "STANDARD",
      estimatedDeliveryDateRange: {
        estimatedDeliveryDate: "2026-10-25T00:00:00Z",
        latestEstimatedDeliveryDate: "2026-10-28T00:00:00Z",
      },
      productVariant: {
        traits: { size: "42" },
        product: { title: "Test Shoe", styleId: "SKU-1" },
      },
      localizedSizeTitle: "42",
    };
    const details = synthesizeBuyOrderDetailsFromListNode(listNode as any);
    const patch = buildOrderMatchEnrichPatchFromStockx(listNode as any, details);
    expect(patch).not.toBeNull();
    expect(patch!.stockxChainId).toBe("chain-abc");
    expect(patch!.stockxOrderId).toBe("order-xyz");
    expect(patch!.stockxOrderNumber).toBe("03-2GJ0J7WHDV");
    expect(patch!.stockxStatus).toBeTruthy();
  });

  it("returns null when chain/order ids missing", () => {
    const details = synthesizeBuyOrderDetailsFromListNode({
      chainId: "",
      orderId: "",
      orderNumber: "03-X",
      amount: 1,
      currencyCode: "CHF",
      productVariant: null,
    } as any);
    expect(buildOrderMatchEnrichPatchFromStockx(null, details)).toBeNull();
  });
});
