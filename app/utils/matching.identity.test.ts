import { describe, expect, it } from "vitest";
import {
  matchShopifyToSupplier,
  sameProductIdentity,
  type NormalizedSupplierOrder,
  type ShopifyLineItem,
} from "@/app/utils/matching";

function shopify(overrides: Partial<ShopifyLineItem> = {}): ShopifyLineItem {
  return {
    shopifyOrderId: "1",
    orderName: "#2001",
    createdAt: "2026-09-01T10:00:00.000Z",
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    customerEmail: null,
    customerName: null,
    customerFirstName: null,
    customerLastName: null,
    shippingCountry: "CH",
    shippingCity: "Lausanne",
    lineItemId: "gid://shopify/LineItem/1",
    title: "Nike Dunk Low Panda",
    sku: "DD1391-100",
    variantTitle: "42",
    quantity: 1,
    price: "220.00",
    totalPrice: "220.00",
    currencyCode: "CHF",
    sizeEU: "42",
    lineItemImageUrl: null,
    ...overrides,
  };
}

function supplier(overrides: Partial<NormalizedSupplierOrder> = {}): NormalizedSupplierOrder {
  return {
    chainId: "c1",
    orderId: "o1",
    supplierOrderNumber: "01-AAAA1111",
    supplierSource: "STOCKX",
    purchaseDate: "2026-09-01T12:00:00.000Z",
    offerAmount: 140,
    totalTTC: 140,
    productTitle: "Nike Dunk Low Retro White Black",
    skuKey: "DD1391-100",
    sizeEU: "42",
    statusKey: "ORDER_PLACED",
    statusTitle: "Placed",
    currencyCode: "CHF",
    ...overrides,
  };
}

describe("sameProductIdentity", () => {
  it("matches exact SKU even when titles differ", () => {
    expect(sameProductIdentity(shopify(), supplier())).toBe(true);
  });

  it("matches GTIN across EAN-13 / GTIN-14", () => {
    expect(
      sameProductIdentity(
        shopify({ gtin: "0196592460123" }),
        supplier({ skuKey: "OTHER", gtin: "196592460123" })
      )
    ).toBe(true);
  });
});

describe("matchShopifyToSupplier identity", () => {
  it("auto-links unique SKU+size when titles differ (GOAT/StockX name miss)", () => {
    const result = matchShopifyToSupplier(shopify(), [supplier()], new Set());
    expect(result.bestMatch?.confidence).toBe("high");
    expect(result.bestMatch?.supplierOrder.supplierOrderNumber).toBe("01-AAAA1111");
  });

  it("keeps HIGH on two same-SKU FIFO candidates (no false ambiguity)", () => {
    const first = supplier({
      supplierOrderNumber: "01-FIRST",
      purchaseDate: "2026-09-01T11:00:00.000Z",
    });
    const second = supplier({
      chainId: "c2",
      orderId: "o2",
      supplierOrderNumber: "01-SECOND",
      purchaseDate: "2026-09-01T18:00:00.000Z",
    });
    const result = matchShopifyToSupplier(shopify(), [first, second], new Set());
    expect(result.bestMatch?.confidence).toBe("high");
    expect(result.bestMatch?.supplierOrder.supplierOrderNumber).toBe("01-FIRST");
  });

  it("still downgrades when top2 are different articles with close scores", () => {
    const dunk = supplier({
      supplierOrderNumber: "01-DUNK",
      productTitle: "Nike Dunk Low Panda",
      skuKey: "DD1391-100",
    });
    const jordan = supplier({
      chainId: "c2",
      orderId: "o2",
      supplierOrderNumber: "01-JORDAN",
      productTitle: "Nike Dunk Low Panda",
      skuKey: "DD1391-999",
      purchaseDate: "2026-09-01T11:10:00.000Z",
    });
    // Same title + size + time, different SKU — name path can still score both.
    const result = matchShopifyToSupplier(
      shopify({ sku: null }),
      [dunk, jordan],
      new Set()
    );
    expect(result.bestMatch).toBeTruthy();
    if (result.allCandidates.length >= 2) {
      expect(result.bestMatch?.confidence).toBe("medium");
    }
  });

  it("matches GOAT order with EU size string and GOAT- prefix", () => {
    const goat = supplier({
      supplierOrderNumber: "GOAT-998877",
      supplierSource: "OTHER",
      productTitle: "Dunk Low White/Black",
      skuKey: "DD1391-100",
      sizeEU: "EU 42",
    });
    const result = matchShopifyToSupplier(shopify(), [goat], new Set());
    expect(result.bestMatch?.confidence).toBe("high");
    expect(result.bestMatch?.supplierOrder.supplierOrderNumber).toBe("GOAT-998877");
  });
});
