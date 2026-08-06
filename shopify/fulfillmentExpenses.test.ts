import { describe, expect, it } from "vitest";
import {
  SHOPIFY_FULFILL_FEE_CHF,
  SHOPIFY_FULFILL_SHIP_CHF,
  SHOPIFY_FULFILL_TOTAL_CHF,
  extractShopifyOrderIdFromFulfillExpenseNote,
  isShopifyShoeFulfillmentLine,
  orderNeedsShopifyFulfillmentFees,
  shopifyFulfillFeeBreakdown,
  shopifyFulfillFeeMarker,
  shopifyFulfillShipMarker,
} from "@/shopify/fulfillmentExpenses";

describe("shopifyFulfillFeeBreakdown", () => {
  it("is fixed 6.50 ship + 8.00 fee", () => {
    expect(shopifyFulfillFeeBreakdown()).toEqual({
      shipChf: SHOPIFY_FULFILL_SHIP_CHF,
      feeChf: SHOPIFY_FULFILL_FEE_CHF,
      totalChf: SHOPIFY_FULFILL_TOTAL_CHF,
    });
    expect(SHOPIFY_FULFILL_SHIP_CHF).toBe(6.5);
    expect(SHOPIFY_FULFILL_FEE_CHF).toBe(8);
    expect(SHOPIFY_FULFILL_TOTAL_CHF).toBe(14.5);
  });
});

describe("markers", () => {
  it("round-trips shopify order id from note", () => {
    const id = "gid://shopify/Order/13397912650114";
    const note = `${shopifyFulfillShipMarker(id)} ship CHF 6.50`;
    expect(extractShopifyOrderIdFromFulfillExpenseNote(note)).toBe(id);
    expect(extractShopifyOrderIdFromFulfillExpenseNote(shopifyFulfillFeeMarker(id))).toBe(id);
  });
});

describe("isShopifyShoeFulfillmentLine", () => {
  it("detects StockX sneaker titles", () => {
    expect(
      isShopifyShoeFulfillmentLine({
        shopifyProductTitle: "adidas Gazelle Indoor Pink Velvet (Women's) - 36",
        shopifySku: "JI2713-36",
        shopifySizeEU: "EU 36",
        stockxStatus: "AC_SHIPPED",
        stockxOrderNumber: "03-ABC",
      })
    ).toBe(true);
  });

  it("skips package protection", () => {
    expect(
      isShopifyShoeFulfillmentLine({
        shopifyProductTitle: "Protection du colis",
        shopifySku: null,
      })
    ).toBe(false);
  });

  it("skips ESSENTIAL_STOCK / ESS-*", () => {
    expect(
      isShopifyShoeFulfillmentLine({
        shopifyProductTitle: "Essentials Hoodie Stretch Limo - M",
        shopifySku: "192HO246258F-M",
        stockxStatus: "ESSENTIAL_STOCK",
        stockxOrderNumber: "ESS-6573",
      })
    ).toBe(false);
  });

  it("skips LEGO / jersey / backpack", () => {
    expect(
      isShopifyShoeFulfillmentLine({
        shopifyProductTitle: "LEGO Star Wars Coruscant Guard Gunship Set 75354 - One Size",
        shopifySku: null,
      })
    ).toBe(false);
    expect(
      isShopifyShoeFulfillmentLine({
        shopifyProductTitle: "adidas Japan 26 Away Jersey Off White/Black - XL",
        shopifySku: null,
      })
    ).toBe(false);
    expect(
      isShopifyShoeFulfillmentLine({
        shopifyProductTitle: "Sprayground Shark Central Late Arrival DLXSV Backpack Multicolor - One Size",
        shopifySku: null,
      })
    ).toBe(false);
  });
});

describe("orderNeedsShopifyFulfillmentFees", () => {
  it("charges once when ≥1 shoe line even if essentials also present", () => {
    expect(
      orderNeedsShopifyFulfillmentFees([
        {
          shopifyProductTitle: "Essentials Tee - M",
          stockxStatus: "ESSENTIAL_STOCK",
          stockxOrderNumber: "ESS-1",
        },
        {
          shopifyProductTitle: "Nike Shox TL Light Army (Women's) - 38.5",
          shopifySku: "AR3566-006-38.5",
          shopifySizeEU: "EU 38.5",
          stockxStatus: "AC_SHIPPED",
          stockxOrderNumber: "03-X",
        },
        { shopifyProductTitle: "Protection du colis" },
      ])
    ).toBe(true);
  });

  it("skips essentials-only orders", () => {
    expect(
      orderNeedsShopifyFulfillmentFees([
        {
          shopifyProductTitle: "Essentials Hoodie - L",
          stockxStatus: "ESSENTIAL_STOCK",
          stockxOrderNumber: "ESS-2",
        },
        { shopifyProductTitle: "Package Protection" },
      ])
    ).toBe(false);
  });

  it("skips non-shoe-only orders", () => {
    expect(
      orderNeedsShopifyFulfillmentFees([
        {
          shopifyProductTitle: "LEGO Creator Big Ben Set 10253 - One Size",
        },
      ])
    ).toBe(false);
  });
});
