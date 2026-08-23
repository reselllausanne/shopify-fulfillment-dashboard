import { describe, expect, it } from "vitest";
import {
  buildRestockFixedPriceNote,
  isRestockFixedPriceNote,
  parseRestockFixedCompareAt,
  resolveOperatorCompareAt,
} from "@/shopify/restock/operatorRestockPrice";

describe("operator restock price helpers", () => {
  it("builds and parses the fixed-price note", () => {
    const note = buildRestockFixedPriceNote(249);
    expect(isRestockFixedPriceNote(note)).toBe(true);
    expect(parseRestockFixedCompareAt(note)).toBe(249);
    expect(isRestockFixedPriceNote("phase4:liquidation")).toBe(false);
    expect(parseRestockFixedCompareAt("restock:fixed-price")).toBeNull();
  });

  it("operator compare-at wins over existing sale anchor", () => {
    expect(
      resolveOperatorCompareAt({
        salePrice: 189,
        operatorCompareAt: 249,
        currentPrice: 129,
        currentCompareAt: 219,
        alreadyOnSale: true,
      })
    ).toBe(249);
  });

  it("falls back to current list when operator compare-at missing and not on sale", () => {
    expect(
      resolveOperatorCompareAt({
        salePrice: 189,
        operatorCompareAt: null,
        currentPrice: 219,
        currentCompareAt: null,
        alreadyOnSale: false,
      })
    ).toBe(219);
  });

  it("ignores compare-at at or below sell", () => {
    expect(
      resolveOperatorCompareAt({
        salePrice: 189,
        operatorCompareAt: 189,
        currentPrice: 129,
        currentCompareAt: null,
        alreadyOnSale: false,
      })
    ).toBeNull();
  });
});
