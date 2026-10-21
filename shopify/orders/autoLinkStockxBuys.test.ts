import { describe, expect, it } from "vitest";
import type { NormalizedSupplierOrder, ShopifyLineItem } from "@/app/utils/matching";
import {
  isStockxBuyMatchableForAutoLink,
  normalizeStockxBuyingNodeForShopifyMatch,
  pickHighConfidenceShopifyStockxLinks,
  shouldAutoApplyShopifyStockxMatch,
  type UnmatchedShopifyLine,
} from "@/shopify/orders/autoLinkStockxBuys";

function shopifyLine(
  partial: Partial<UnmatchedShopifyLine> &
    Pick<ShopifyLineItem, "title" | "createdAt" | "orderName" | "lineItemId" | "sku" | "sizeEU">
): UnmatchedShopifyLine {
  return {
    shopifyOrderId: partial.shopifyOrderId ?? "1001",
    orderName: partial.orderName,
    createdAt: partial.createdAt,
    displayFinancialStatus: partial.displayFinancialStatus ?? "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    customerEmail: null,
    customerName: null,
    customerFirstName: null,
    customerLastName: null,
    shippingCountry: "CH",
    shippingCity: "Lausanne",
    lineItemId: partial.lineItemId,
    title: partial.title,
    sku: partial.sku,
    variantTitle: partial.sizeEU,
    quantity: 1,
    price: "200",
    totalPrice: "200",
    currencyCode: "CHF",
    sizeEU: partial.sizeEU,
    lineItemImageUrl: null,
    qty: 1,
  };
}

function buy(
  partial: Partial<NormalizedSupplierOrder> &
    Pick<NormalizedSupplierOrder, "supplierOrderNumber" | "purchaseDate" | "productTitle" | "skuKey" | "sizeEU">
): NormalizedSupplierOrder {
  return {
    chainId: partial.chainId ?? `chain-${partial.supplierOrderNumber}`,
    orderId: partial.orderId ?? partial.supplierOrderNumber,
    supplierOrderNumber: partial.supplierOrderNumber,
    supplierSource: "STOCKX",
    purchaseDate: partial.purchaseDate,
    offerAmount: partial.offerAmount ?? 120,
    totalTTC: partial.totalTTC ?? null,
    productTitle: partial.productTitle,
    skuKey: partial.skuKey,
    sizeEU: partial.sizeEU,
    statusKey: partial.statusKey ?? "ORDERED",
    statusTitle: "Ordered",
    currencyCode: "CHF",
  };
}

describe("normalizeStockxBuyingNodeForShopifyMatch", () => {
  it("maps styleId + EU size + amount", () => {
    const norm = normalizeStockxBuyingNodeForShopifyMatch({
      orderNumber: "03-ABC123",
      orderId: "03-ABC123",
      chainId: "chain-9",
      creationDate: "2026-10-20T12:00:00Z",
      amount: 150,
      localizedSizeTitle: "EU 42",
      localizedSizeType: "eu",
      productVariant: {
        styleId: "DD1391-100",
        product: { title: "Nike Dunk Low" },
      },
      state: { statusKey: "ORDERED", statusTitle: "Ordered" },
      currencyCode: "CHF",
    } as any);

    expect(norm).toMatchObject({
      supplierOrderNumber: "03-ABC123",
      skuKey: "DD1391-100",
      sizeEU: "42",
      offerAmount: 150,
      productTitle: "Nike Dunk Low",
    });
  });

  it("returns null when order number missing", () => {
    expect(
      normalizeStockxBuyingNodeForShopifyMatch({
        orderId: "x",
        orderNumber: "",
      } as any)
    ).toBeNull();
  });
});

describe("isStockxBuyMatchableForAutoLink", () => {
  it("rejects cancelled / refunded", () => {
    expect(isStockxBuyMatchableForAutoLink("CANCELED")).toBe(false);
    expect(isStockxBuyMatchableForAutoLink("REFUNDED")).toBe(false);
    expect(isStockxBuyMatchableForAutoLink("ORDERED")).toBe(true);
    expect(isStockxBuyMatchableForAutoLink(null)).toBe(true);
  });
});

describe("shouldAutoApplyShopifyStockxMatch", () => {
  it("allows high + real StockX + cost", () => {
    expect(
      shouldAutoApplyShopifyStockxMatch({
        confidence: "high",
        stockxOrderNumber: "03-ABC",
        suggestedCost: 99,
      })
    ).toBe(true);
  });

  it("blocks medium / low / synthetic / no cost", () => {
    expect(
      shouldAutoApplyShopifyStockxMatch({
        confidence: "medium",
        stockxOrderNumber: "03-ABC",
        suggestedCost: 99,
      })
    ).toBe(false);
    expect(
      shouldAutoApplyShopifyStockxMatch({
        confidence: "high",
        stockxOrderNumber: "PHYS-123",
        suggestedCost: 99,
      })
    ).toBe(false);
    expect(
      shouldAutoApplyShopifyStockxMatch({
        confidence: "high",
        stockxOrderNumber: "03-ABC",
        suggestedCost: null,
      })
    ).toBe(false);
  });
});

describe("pickHighConfidenceShopifyStockxLinks", () => {
  it("auto-picks clear SKU+size+time match and skips ambiguous pair", () => {
    const line = shopifyLine({
      orderName: "#2001",
      lineItemId: "li-1",
      title: "Nike Dunk Low Retro White",
      sku: "DD1391-100",
      sizeEU: "42",
      createdAt: "2026-10-20T10:00:00Z",
    });

    const clear = buy({
      supplierOrderNumber: "03-CLEAR1",
      purchaseDate: "2026-10-20T11:00:00Z",
      productTitle: "Nike Dunk Low Retro White",
      skuKey: "DD1391-100",
      sizeEU: "42",
      offerAmount: 130,
    });

    const { picks, noneSkipped } = pickHighConfidenceShopifyStockxLinks({
      lines: [line],
      supplierOrders: [clear],
      usedSupplierNumbers: new Set(),
    });

    expect(picks).toHaveLength(1);
    expect(picks[0].supplier.supplierOrderNumber).toBe("03-CLEAR1");
    expect(noneSkipped).toBe(0);
  });

  it("skips when StockX buy already used", () => {
    const line = shopifyLine({
      orderName: "#2002",
      lineItemId: "li-2",
      title: "Nike Dunk Low Retro White",
      sku: "DD1391-100",
      sizeEU: "42",
      createdAt: "2026-10-20T10:00:00Z",
    });
    const clear = buy({
      supplierOrderNumber: "03-TAKEN",
      purchaseDate: "2026-10-20T11:00:00Z",
      productTitle: "Nike Dunk Low Retro White",
      skuKey: "DD1391-100",
      sizeEU: "42",
    });

    const { picks, noneSkipped } = pickHighConfidenceShopifyStockxLinks({
      lines: [line],
      supplierOrders: [clear],
      usedSupplierNumbers: new Set(["03-TAKEN"]),
    });

    expect(picks).toHaveLength(0);
    expect(noneSkipped).toBe(1);
  });

  it("does not auto-link when two identical buys make match ambiguous", () => {
    const line = shopifyLine({
      orderName: "#2003",
      lineItemId: "li-3",
      title: "Adidas Samba OG",
      sku: "B75806",
      sizeEU: "42",
      createdAt: "2026-10-20T10:00:00Z",
    });
    const a = buy({
      supplierOrderNumber: "03-A",
      purchaseDate: "2026-10-20T11:00:00Z",
      productTitle: "Adidas Samba OG",
      skuKey: "B75806",
      sizeEU: "42",
      offerAmount: 100,
    });
    const b = buy({
      supplierOrderNumber: "03-B",
      purchaseDate: "2026-10-20T11:05:00Z",
      productTitle: "Adidas Samba OG",
      skuKey: "B75806",
      sizeEU: "42",
      offerAmount: 100,
    });

    const { picks, mediumSkipped, lowSkipped, mediumCandidates } =
      pickHighConfidenceShopifyStockxLinks({
        lines: [line],
        supplierOrders: [a, b],
        usedSupplierNumbers: new Set(),
      });

    // Ambiguity inside matchShopifyToSupplier downgrades HIGH → medium.
    expect(picks).toHaveLength(0);
    expect(mediumSkipped + lowSkipped).toBeGreaterThanOrEqual(1);
    expect(mediumCandidates.length + lowSkipped).toBeGreaterThanOrEqual(1);
    if (mediumCandidates.length) {
      expect(mediumCandidates[0].confidence).toBe("medium");
      expect(["03-A", "03-B"]).toContain(
        mediumCandidates[0].supplier.supplierOrderNumber
      );
    }
  });
});
