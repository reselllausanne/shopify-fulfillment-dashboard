import { describe, expect, it } from "vitest";
import {
  matchShopifyToSupplier,
  type NormalizedSupplierOrder,
  type ShopifyLineItem,
} from "@/app/utils/matching";
import type { AvailableLocalStockLot } from "@/shopify/localStock/availableLocalStock";

const shopifyItem: ShopifyLineItem = {
  shopifyOrderId: "gid://shopify/Order/1",
  orderName: "#1001",
  createdAt: "2026-07-10T10:00:00Z",
  displayFinancialStatus: "PAID",
  displayFulfillmentStatus: "UNFULFILLED",
  customerEmail: null,
  customerName: null,
  customerFirstName: null,
  customerLastName: null,
  shippingCountry: "CH",
  shippingCity: "Lausanne",
  lineItemId: "gid://shopify/LineItem/1",
  title: "Nike Dunk Low",
  sku: "SKU-LOCAL-42",
  variantTitle: "42",
  quantity: 1,
  price: "199.00",
  totalPrice: "199.00",
  currencyCode: "CHF",
  sizeEU: "42",
  lineItemImageUrl: null,
};

const stockxOrder: NormalizedSupplierOrder = {
  chainId: "chain-1",
  orderId: "stockx-1",
  supplierOrderNumber: "12345678",
  purchaseDate: "2026-07-10T11:00:00Z",
  offerAmount: 120,
  totalTTC: 140,
  productTitle: "Nike Dunk Low",
  skuKey: "SKU-LOCAL",
  sizeEU: "42",
  statusKey: "ORDER_PLACED",
  statusTitle: "Order placed",
  currencyCode: "CHF",
};

describe("matchShopifyToSupplier local stock", () => {
  it("returns LOCAL synthetic match before StockX candidates", () => {
    const lot: AvailableLocalStockLot = {
      sku: "SKU-LOCAL-42",
      lotId: "lot-123456789",
      qtyAvailable: 1,
      unitCostChf: 88,
      costBasis: "ACQUISITION",
      origin: "CUSTOMER_RETURN",
      locationId: "loc-1",
      locationName: "Bussigny",
      enteredAt: "2026-07-01T00:00:00Z",
    };

    const result = matchShopifyToSupplier(shopifyItem, [stockxOrder], new Set(), lot);

    expect(result.bestMatch?.supplierOrder.supplierSource).toBe("LOCAL");
    expect(result.bestMatch?.supplierOrder.statusKey).toBe("LOCAL_STOCK");
    expect(result.bestMatch?.supplierOrder.supplierOrderNumber).toBe("LOCAL-lot-1234");
    expect(result.bestMatch?.supplierOrder.totalTTC).toBe(88);
    expect(result.bestMatch?.confidence).toBe("high");
    expect(result.allCandidates).toHaveLength(1);
  });

  it("uses zero synthetic cost for already-expensed local lots", () => {
    const lot: AvailableLocalStockLot = {
      sku: "SKU-LOCAL-42",
      lotId: "lot-expensed",
      qtyAvailable: 1,
      unitCostChf: 120,
      costBasis: "ALREADY_EXPENSED",
      origin: "ESSENTIALS",
      locationId: "loc-2",
      locationName: "THE LAB",
      enteredAt: "2026-07-01T00:00:00Z",
    };

    const result = matchShopifyToSupplier(shopifyItem, [], new Set(), lot);

    expect(result.bestMatch?.supplierOrder.offerAmount).toBe(0);
    expect(result.bestMatch?.supplierOrder.totalTTC).toBe(0);
    expect(result.bestMatch?.reasons).toContain("Origin ESSENTIALS");
  });
});
