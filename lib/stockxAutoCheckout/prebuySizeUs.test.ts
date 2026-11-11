import { describe, expect, it } from "vitest";
import { sizeMatchesUsTrait } from "@/lib/stockxAutoCheckout/prebuyDedupe";

describe("sizeMatchesUsTrait", () => {
  it("matches a US-labelled Shopify size to the StockX US trait", () => {
    expect(sizeMatchesUsTrait("11", "11")).toBe(true);
    expect(sizeMatchesUsTrait("8", "8W")).toBe(true);
    expect(sizeMatchesUsTrait("5.5", "5.5Y")).toBe(true);
  });
  it("rejects different sizes and adult EU labels", () => {
    expect(sizeMatchesUsTrait("11", "10.5")).toBe(false);
    expect(sizeMatchesUsTrait("44", "44")).toBe(false);
    expect(sizeMatchesUsTrait(null, "11")).toBe(false);
  });
});
