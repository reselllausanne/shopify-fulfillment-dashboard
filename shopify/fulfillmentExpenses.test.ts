import { describe, expect, it } from "vitest";
import {
  SHOPIFY_FULFILL_FEE_CHF,
  SHOPIFY_FULFILL_SHIP_CHF,
  SHOPIFY_FULFILL_TOTAL_CHF,
  extractShopifyOrderIdFromFulfillExpenseNote,
  isPhysicalShopifyLocation,
  isShopifyManualInStockRef,
  isShopifyShoeFulfillmentLine,
  orderIsPhysicalInStockShoeOnly,
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

  it("skips LOCAL / physical warehouse FO / manual in-stock refs", () => {
    expect(
      isShopifyShoeFulfillmentLine({
        shopifyProductTitle: "Nike Dunk Low Retro White Black - 42",
        shopifySku: "DD1391-100-42",
        shopifySizeEU: "42",
        supplierSource: "LOCAL",
        stockxStatus: "LOCAL_STOCK",
        stockxOrderNumber: "LOCAL-abc",
      })
    ).toBe(false);
    expect(
      isShopifyShoeFulfillmentLine({
        shopifyProductTitle: "adidas Samba OG White - 42",
        shopifySku: "B75806-42",
        shopifySizeEU: "42",
        stockxStatus: "AC_SHIPPED",
        stockxOrderNumber: "03-X",
        fulfilledFromPhysical: true,
      })
    ).toBe(false);
    expect(
      isShopifyShoeFulfillmentLine({
        shopifyProductTitle: "On Running Cloudtilt Black Ivory - 46",
        shopifySizeEU: "46",
        stockxStatus: "MANUAL",
        stockxOrderNumber: "in stock ",
        matchType: "MANUAL",
        matchReasons: '["Manual entry"]',
      })
    ).toBe(false);
    expect(isShopifyManualInStockRef({ stockxOrderNumber: "in stock " })).toBe(true);
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

  it("skips physical-warehouse shoe-only orders", () => {
    const lines = [
      {
        shopifyProductTitle: "Nike Dunk Low Retro White Black - 42",
        shopifySku: "DD1391-100-42",
        shopifySizeEU: "42",
        fulfilledFromPhysical: true,
      },
    ];
    expect(orderIsPhysicalInStockShoeOnly(lines)).toBe(true);
    expect(orderNeedsShopifyFulfillmentFees(lines)).toBe(false);
  });

  it("still charges when dropship shoe + physical shoe mixed", () => {
    expect(
      orderNeedsShopifyFulfillmentFees([
        {
          shopifyProductTitle: "Nike Dunk Low Retro White Black - 42",
          fulfilledFromPhysical: true,
        },
        {
          shopifyProductTitle: "Nike Shox TL Light Army (Women's) - 38.5",
          shopifySku: "AR3566-006-38.5",
          shopifySizeEU: "EU 38.5",
          stockxStatus: "AC_SHIPPED",
          stockxOrderNumber: "03-X",
          fulfilledFromPhysical: false,
        },
      ])
    ).toBe(true);
  });
});

describe("isPhysicalShopifyLocation", () => {
  it("detects Bussigny / Lab by name", () => {
    expect(isPhysicalShopifyLocation(null, "Warehouse Bussigny")).toBe(true);
    expect(isPhysicalShopifyLocation(null, "THE LAB CONCEPT STORE")).toBe(true);
    expect(isPhysicalShopifyLocation(null, "Chemin de Bas-de-Plan 6")).toBe(false);
  });
});
