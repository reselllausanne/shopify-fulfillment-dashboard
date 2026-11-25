import { describe, expect, it } from "vitest";
import { computeStxSellPrices, flatSellChfForName } from "./syncShopifyStxPrices";

describe("flat sell rules", () => {
  it("matches Lowmel Chestnut/Sand/Black Women's only", () => {
    expect(flatSellChfForName("UGG Lowmel Sand (Women's)")).toBe(229);
    expect(flatSellChfForName("UGG Lowmel Chestnut (Women's)")).toBe(229);
    expect(flatSellChfForName("UGG Lowmel Black (Women's)")).toBe(229);
    expect(flatSellChfForName("UGG Lowmel Black (Kids)")).toBeNull();
    expect(flatSellChfForName("UGG Lowmel Pumice (Women's)")).toBeNull();
  });
  it("overrides computed price", () => {
    const r = computeStxSellPrices({
      stxRow: { deliveryType: null, price: 155, standardBuyPrice: 155, expressBuyPrice: null, supplierProductName: "UGG Lowmel Sand (Women's)", supplierBrand: "UGG" },
      productHandle: null,
    });
    expect(r.normalSell).toBe(229);
  });
});
