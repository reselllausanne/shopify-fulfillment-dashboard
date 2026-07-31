import { describe, expect, it } from "vitest";
import {
  classifyProductPricingKind,
  computeChannelVariantPrice,
  isPlusSizeProduct,
} from "@/inventory/pricingPolicy";

describe("inventory pricing policy", () => {
  it("detects plus-size from EU sizing", () => {
    expect(
      isPlusSizeProduct({
        title: "Air Force",
        sizeEu: "EU 48",
      })
    ).toBe(true);
  });

  it("does not classify titles with % as liquidation", () => {
    expect(
      classifyProductPricingKind({
        title: "Jordan 15%",
        sizeEu: "EU 48",
      })
    ).toBe("plus_size");
    expect(
      classifyProductPricingKind({
        title: "Nike Dunk 20%",
        sizeEu: "EU 42",
      })
    ).toBe("normal");
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
