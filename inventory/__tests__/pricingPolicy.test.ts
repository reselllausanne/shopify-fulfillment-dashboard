import { describe, expect, it } from "vitest";
import {
  classifyProductPricingKind,
  computeChannelVariantPrice,
  isLiquidationProductTitle,
  isPlusSizeProduct,
} from "@/inventory/pricingPolicy";

describe("inventory pricing policy", () => {
  it("detects liquidation title suffix", () => {
    expect(isLiquidationProductTitle("Nike Dunk 20%")).toBe(true);
    expect(isLiquidationProductTitle("Nike 100% cotton tee")).toBe(false);
  });

  it("detects plus-size from EU sizing", () => {
    expect(
      isPlusSizeProduct({
        title: "Air Force",
        sizeEu: "EU 48",
      })
    ).toBe(true);
  });

  it("classifies liquidation before plus-size", () => {
    expect(
      classifyProductPricingKind({
        title: "Jordan 15%",
        sizeEu: "EU 48",
      })
    ).toBe("liquidation");
  });

  it("applies plus-size multiplier on Shopify", () => {
    const price = computeChannelVariantPrice({
      channel: "SHOPIFY",
      basePrice: 100,
      classification: "plus_size",
    });
    expect(price).toBe(108);
  });
});
