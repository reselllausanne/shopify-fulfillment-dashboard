import { describe, expect, it } from "vitest";
import { deriveStockxRawAskFromStoredBuyPrice } from "@/galaxus/pricing/suggestedSellPrice";
import {
  calcShopifySellPrice,
  calcPhysicalLiquidationSellPrice,
  explainShopifySellPrice,
  resolveShopifyPricingRule,
  SHOPIFY_CPA_CAP_HALF,
} from "@/shopify/pricing/calcShopifySellPrice";

/** Live cost band — buy CHF 140 → HALF sell 239 (never former FULL 249). */
const BUY_CHF_140 = 140;
const EXPECTED_RAW_FROM_BUY_140 = 108.45;
const EXPECTED_HALF_SELL_FROM_BUY_140 = 239;

const ADIDAS_LIFESTYLE = [
  {
    family: "Samba",
    handle: "adidas-samba-og-cloud-white-core-black",
    name: "Adidas Samba OG White",
  },
  {
    family: "Gazelle",
    handle: "adidas-gazelle-indoor-blue-bird",
    name: "Adidas Gazelle Indoor Blue",
  },
  {
    family: "Spezial",
    handle: "adidas-handball-spezial-grey",
    name: "Adidas Handball Spezial Grey",
  },
  {
    family: "Campus",
    handle: "adidas-campus-00s-grey-white",
    name: "Adidas Campus 00s Grey White",
  },
] as const;

describe("calcShopifySellPrice", () => {
  it("prices brands the same (HALF only)", () => {
    const adidas = calcShopifySellPrice({
      stockxRaw: 100,
      productCategory: "sneakers",
      brand: "adidas",
      productHandle: "adidas-samba-xlg-black-carbon",
    });
    const nike = calcShopifySellPrice({
      stockxRaw: 100,
      productCategory: "sneakers",
      brand: "nike",
      productHandle: "nike-dunk-low",
    });
    const saucony = calcShopifySellPrice({
      stockxRaw: 100,
      productCategory: "sneakers",
      brand: "saucony",
      productHandle: "saucony-progrid",
    });
    expect(adidas).toBe(229);
    expect(adidas).toBe(nike);
    expect(adidas).toBe(saucony);
  });

  it("Samba / Gazelle / Spezial / Campus at buy CHF 140 → HALF 239 (not 249)", () => {
    for (const row of ADIDAS_LIFESTYLE) {
      const raw = deriveStockxRawAskFromStoredBuyPrice(BUY_CHF_140, {
        slug: row.handle,
        urlKey: row.handle,
        name: row.name,
      });
      expect(raw).toBe(EXPECTED_RAW_FROM_BUY_140);
      const sell = calcShopifySellPrice({
        stockxRaw: raw!,
        productCategory: "sneakers",
        brand: "adidas",
        productHandle: row.handle,
        productName: row.name,
      });
      expect(sell, row.family).toBe(EXPECTED_HALF_SELL_FROM_BUY_140);
      expect(sell, `${row.family} must not be FULL 249`).not.toBe(249);

      const explained = explainShopifySellPrice({
        stockxRaw: raw!,
        productCategory: "sneakers",
        brand: "adidas",
        productHandle: row.handle,
        productName: row.name,
      });
      expect(explained.rule).toBe("half");
      expect(explained.cpaCap).toBe(SHOPIFY_CPA_CAP_HALF);
      expect(explained.calculatedSell).toBe(EXPECTED_HALF_SELL_FROM_BUY_140);
    }
  });

  it("mirror live SSE costs: stockx_raw 100/126/170 → HALF sells", () => {
    expect(
      calcShopifySellPrice({
        stockxRaw: 100,
        productHandle: "adidas-samba-og-white",
        brand: "adidas",
      })
    ).toBe(229);
    expect(
      calcShopifySellPrice({
        stockxRaw: 126,
        productHandle: "adidas-gazelle-indoor",
        brand: "adidas",
      })
    ).toBe(269);
    expect(
      calcShopifySellPrice({
        stockxRaw: 170,
        productHandle: "adidas-handball-spezial",
        brand: "adidas",
      })
    ).toBe(339);
    expect(resolveShopifyPricingRule({ productHandle: "adidas-campus-00s" })).toBe("half");
  });

  it("returns psych-rounded lego price", () => {
    const price = calcShopifySellPrice({
      stockxRaw: 80,
      productCategory: "lego",
      productHandle: "lego-random-set",
    });
    expect(price).not.toBeNull();
    expect([9, 19, 29, 39, 49, 59, 69, 79, 89, 99].includes(price! % 100)).toBe(true);
    expect(resolveShopifyPricingRule({ productCategory: "lego" })).toBe("lego");
  });
});

describe("calcPhysicalLiquidationSellPrice", () => {
  it("applies 30% off cost with psych rounding (261.92 → 189)", () => {
    expect(calcPhysicalLiquidationSellPrice(261.92)).toBe(189);
  });
});
