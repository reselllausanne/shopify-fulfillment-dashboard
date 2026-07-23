import { describe, expect, it } from "vitest";
import {
  calcShopifySellPrice,
  calcPhysicalLiquidationSellPrice,
} from "@/shopify/pricing/calcShopifySellPrice";

describe("calcShopifySellPrice", () => {
  it("applies Adidas sneaker brand discount", () => {
    const price = calcShopifySellPrice({
      stockxRaw: 120,
      productCategory: "sneakers",
      brand: "adidas",
      productHandle: "adidas-samba-xlg-black-carbon",
    });
    expect(price).not.toBeNull();
    expect(price!).toBeGreaterThan(150);
    expect(price! % 10).toBe(9);
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
