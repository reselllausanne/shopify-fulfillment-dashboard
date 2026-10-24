import { describe, expect, it } from "vitest";
import {
  SHOPIFY_BUY_OK_9,
  SHOPIFY_STANDARD_BATCH_13,
} from "@/lib/stockxAutoCheckout/shopifyBatchBuy";

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

describe("SHOPIFY_BUY_OK_9", () => {
  it("has the 9 GO cohort orders", () => {
    expect(SHOPIFY_BUY_OK_9).toHaveLength(9);
    const names = SHOPIFY_BUY_OK_9.map((i) => i.orderName);
    expect(names).toEqual([
      "#7298",
      "#7302",
      "#7538",
      "#7535",
      "#7540",
      "#7532",
      "#7542",
      "#7536",
      "#7534",
    ]);
  });
});
