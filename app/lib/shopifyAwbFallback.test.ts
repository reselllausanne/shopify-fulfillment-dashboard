import { describe, expect, it } from "vitest";
import { resolveShopifyAwbFallbackMatch } from "@/app/lib/shopifyAwbFallback";

const pkg = {
  awb: "1ZTEST",
  sku: "DJ5718-001",
  sizeEU: "42",
  productName: "Nike",
  purchaseDate: "2026-09-12T15:00:00.000Z",
};

describe("shopifyAwbFallback", () => {
  it("returns none when no open lines", () => {
    expect(resolveShopifyAwbFallbackMatch(pkg, []).status).toBe("none");
  });

  it("exact match on sku+size+causal", () => {
    const result = resolveShopifyAwbFallbackMatch(pkg, [
      {
        shopifyOrderId: "o1",
        shopifyOrderName: "#1001",
        shopifyLineItemId: "li1",
        shopifySku: "DJ5718-001",
        shopifySizeEU: "42",
        shopifyProductTitle: "Nike",
        shopifyCreatedAt: "2026-09-12T10:00:00.000Z",
        remainingQuantity: 1,
      },
    ]);
    expect(result.status).toBe("exact");
  });

  it("rejects when StockX buy is before customer order", () => {
    const result = resolveShopifyAwbFallbackMatch(pkg, [
      {
        shopifyOrderId: "o1",
        shopifyOrderName: "#1001",
        shopifyLineItemId: "li1",
        shopifySku: "DJ5718-001",
        shopifySizeEU: "42",
        shopifyProductTitle: "Nike",
        shopifyCreatedAt: "2026-09-13T10:00:00.000Z",
        remainingQuantity: 1,
      },
    ]);
    expect(result.status).toBe("none");
  });

  it("ambiguous when two exact open lines", () => {
    const result = resolveShopifyAwbFallbackMatch(pkg, [
      {
        shopifyOrderId: "o1",
        shopifyOrderName: "#1001",
        shopifyLineItemId: "li1",
        shopifySku: "DJ5718-001",
        shopifySizeEU: "42",
        shopifyProductTitle: "Nike",
        shopifyCreatedAt: "2026-09-12T10:00:00.000Z",
        remainingQuantity: 1,
      },
      {
        shopifyOrderId: "o2",
        shopifyOrderName: "#1002",
        shopifyLineItemId: "li2",
        shopifySku: "dj5718-001",
        shopifySizeEU: "EU 42",
        shopifyProductTitle: "Nike",
        shopifyCreatedAt: "2026-09-11T10:00:00.000Z",
        remainingQuantity: 1,
      },
    ]);
    expect(result.status).toBe("ambiguous");
  });
});
