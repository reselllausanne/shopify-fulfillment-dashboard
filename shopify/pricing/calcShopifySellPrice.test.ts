import { describe, expect, it } from "vitest";
import {
  calcShopifySellPrice,
  calcPhysicalLiquidationSellPrice,
  explainShopifySellPrice,
  isAdidasLifestyleFullCpa,
  resolveShopifyPricingRule,
  SHOPIFY_CPA_CAP_HALF,
} from "@/shopify/pricing/calcShopifySellPrice";

describe("calcShopifySellPrice", () => {
  it("prices brands the same after removing margin discounts", () => {
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
    expect(adidas).not.toBeNull();
    expect(nike).not.toBeNull();
    expect(saucony).not.toBeNull();
    expect(adidas).toBe(nike);
    expect(adidas).toBe(saucony);
    expect(adidas! % 10).toBe(9);
  });

  it("applies HALF (CPA 24) even on former FULL adidas lifestyle families", () => {
    expect(
      isAdidasLifestyleFullCpa({
        productHandle: "adidas-samba-og",
        brand: "adidas",
        productName: "Samba OG",
      })
    ).toBe(false);

    const samba = explainShopifySellPrice({
      stockxRaw: 170,
      productCategory: "sneakers",
      brand: "adidas",
      productHandle: "adidas-samba-og-white",
      productName: "adidas Samba OG",
    });
    const dunk = explainShopifySellPrice({
      stockxRaw: 170,
      productCategory: "sneakers",
      brand: "nike",
      productHandle: "nike-dunk-low",
    });

    expect(samba.rule).toBe("half");
    expect(dunk.rule).toBe("half");
    expect(samba.cpaCap).toBe(SHOPIFY_CPA_CAP_HALF);
    expect(samba.calculatedSell).toBe(dunk.calculatedSell);
    expect(resolveShopifyPricingRule({ productHandle: "adidas-gazelle" })).toBe("half");
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
