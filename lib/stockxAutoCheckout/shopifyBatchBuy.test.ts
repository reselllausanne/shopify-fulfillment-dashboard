import { describe, expect, it } from "vitest";
import { SHOPIFY_STANDARD_BATCH_13 } from "@/lib/stockxAutoCheckout/shopifyBatchBuy";

describe("SHOPIFY_STANDARD_BATCH_13", () => {
  it("has 13 planned STANDARD items with slug + EU size", () => {
    expect(SHOPIFY_STANDARD_BATCH_13).toHaveLength(13);
    for (const item of SHOPIFY_STANDARD_BATCH_13) {
      expect(item.orderName).toMatch(/^#\d+$/);
      expect(item.slug.length).toBeGreaterThan(5);
      expect(item.sizeEU.trim().length).toBeGreaterThan(0);
    }
  });

  it("excludes Mercurial #7424 and Essentials #7513", () => {
    const names = new Set(SHOPIFY_STANDARD_BATCH_13.map((i) => i.orderName));
    expect(names.has("#7424")).toBe(false);
    expect(names.has("#7513")).toBe(false);
  });
});
