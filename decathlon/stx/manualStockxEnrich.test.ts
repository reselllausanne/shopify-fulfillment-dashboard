import { describe, expect, it } from "vitest";
import {
  looksLikeStockxOrderNumber,
  normalizeStockxOrderNumberInput,
} from "@/decathlon/stx/manualStockxEnrich";
import { buyOrderNumbersMatch } from "@/galaxus/stx/stockxClient";

describe("normalizeStockxOrderNumberInput", () => {
  it("strips leading hash from Pro paste", () => {
    expect(normalizeStockxOrderNumberInput("#03-2GJ0J7WHDV")).toBe("03-2GJ0J7WHDV");
    expect(normalizeStockxOrderNumberInput("##03-2GJ0J7WHDV")).toBe("03-2GJ0J7WHDV");
  });
});

describe("looksLikeStockxOrderNumber", () => {
  it("accepts hashed and bare StockX order numbers", () => {
    expect(looksLikeStockxOrderNumber("#03-2GJ0J7WHDV")).toBe(true);
    expect(looksLikeStockxOrderNumber("03-2GJ0J7WHDV")).toBe(true);
  });

  it("rejects empty / urls / spaces", () => {
    expect(looksLikeStockxOrderNumber("")).toBe(false);
    expect(looksLikeStockxOrderNumber("https://stockx.com/x")).toBe(false);
    expect(looksLikeStockxOrderNumber("03 2GJ0")).toBe(false);
  });
});

describe("buyOrderNumbersMatch", () => {
  it("matches with or without leading hash", () => {
    expect(buyOrderNumbersMatch("03-2GJ0J7WHDV", "#03-2GJ0J7WHDV")).toBe(true);
    expect(buyOrderNumbersMatch("#03-2GJ0J7WHDV", "03-2GJ0J7WHDV")).toBe(true);
  });
});

describe("synthesizeBuyOrderDetailsFromListNode", () => {
  it("maps list amount and ETA into settledAmount shape", async () => {
    const { synthesizeBuyOrderDetailsFromListNode } = await import("@/galaxus/stx/stockxClient");
    const details = synthesizeBuyOrderDetailsFromListNode({
      chainId: "c1",
      orderId: "oid",
      orderNumber: "01-ABC",
      amount: 54.8,
      currencyCode: "CHF",
      purchaseDate: "2026-08-23T00:00:00Z",
      state: { statusKey: "ORDER_CONFIRMED" },
      checkoutType: "XPRESS",
      estimatedDeliveryDateRange: {
        estimatedDeliveryDate: "2026-08-26T00:00:00Z",
        latestEstimatedDeliveryDate: "2026-08-31T00:00:00Z",
      },
      productVariant: null,
    });
    expect(details.order.payment.settledAmount).toEqual({ value: "54.8", currency: "CHF" });
    expect(details.etaMin?.toISOString().startsWith("2026-08-26")).toBe(true);
    expect(details.etaMax?.toISOString().startsWith("2026-08-31")).toBe(true);
  });
});