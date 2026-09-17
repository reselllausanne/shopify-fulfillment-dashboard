import { describe, expect, it } from "vitest";
import {
  calcShopifySellPrice,
  calcPhysicalLiquidationSellPrice,
} from "@/shopify/pricing/calcShopifySellPrice";

describe("calcShopifySellPrice", () => {
  it("adidas sneakers get −5% vs other brands (mid rollback from FULL CPA)", () => {
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
    expect(adidas).toBe(219);
    expect(nike).toBe(229);
    expect(saucony).toBe(229);
    expect(adidas! % 10).toBe(9);
  });

  it("returns psych-rounded lego price", () => {
    const price = calcShopifySellPrice({
      stockxRaw: 80,
      productCategory: "lego",
      productHandle: "lego-random-set",
    });
    expect(price).not.toBeNull();
    expect([9, 19, 29, 39, 49, 59, 69, 79, 89, 99].includes(price! % 100)).toBe(true);
  });
});

describe("calcPhysicalLiquidationSellPrice", () => {
  it("applies 30% off cost with psych rounding (261.92 → 189)", () => {
    expect(calcPhysicalLiquidationSellPrice(261.92)).toBe(189);
  });
});
