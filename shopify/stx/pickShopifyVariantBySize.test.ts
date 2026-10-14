import { describe, expect, it } from "vitest";
import {
  isPlaceholderKickdbOneSize,
  pickShopifyVariantBySize,
} from "@/shopify/stx/syncShopifyStxPrices";

describe("pickShopifyVariantBySize", () => {
  it("returns the only variant on single-SKU products", () => {
    const variants = [
      {
        id: "1",
        title: "One Size",
        sku: "cb8df497-65d1-4290-a1e4-25b326af604e-OS",
        usSize: { value: null },
      },
    ];
    expect(pickShopifyVariantBySize(variants, null, "US")).toBe(variants[0]);
  });

  it("matches One Size when KickDB has placeholder US size", () => {
    const variants = [
      { title: "42", sku: "x-42", usSize: { value: "9" } },
      {
        title: "One Size",
        sku: "box-OS",
        usSize: { value: null },
      },
    ];
    expect(isPlaceholderKickdbOneSize(null, "US")).toBe(true);
    expect(pickShopifyVariantBySize(variants, null, "US")).toEqual(
      expect.objectContaining({ title: "One Size" })
    );
  });

  it("still matches EU size titles for footwear", () => {
    const variants = [
      { title: "37.5", sku: "a", usSize: { value: "6.5" } },
      { title: "45", sku: "b", usSize: { value: "11" } },
    ];
    expect(pickShopifyVariantBySize(variants, "37.5", "6.5")).toEqual(
      expect.objectContaining({ title: "37.5" })
    );
  });
});
