import { describe, expect, it } from "vitest";
import {
  PUBLIC_RETURN_MAX_UNIT_PRICE_CHF,
  hasCompareAtPromo,
  isPriceOverReturnLimit,
  isSaleCollectionHandle,
  isSaleOrPromoItem,
  resolveReturnExcludeReason,
  splitReturnableByEligibility,
} from "../returnEligibility";

describe("returnEligibility", () => {
  it(`blocks CHF prices over ${PUBLIC_RETURN_MAX_UNIT_PRICE_CHF}`, () => {
    expect(isPriceOverReturnLimit(650, "CHF")).toBe(false);
    expect(isPriceOverReturnLimit(650.01, "CHF")).toBe(true);
    expect(isPriceOverReturnLimit(900, "EUR")).toBe(false);
  });

  it("detects soldes collections and tags", () => {
    expect(isSaleCollectionHandle("soldes-48h")).toBe(true);
    expect(isSaleCollectionHandle("new-arrivals")).toBe(false);
    expect(isSaleOrPromoItem({ unitAmount: 120, productTags: ["Soldes"] })).toBe(true);
    expect(isSaleOrPromoItem({ unitAmount: 120, delivery48h: "true" })).toBe(true);
    expect(isSaleOrPromoItem({ unitAmount: 120, priceLocked: "true" })).toBe(true);
  });

  it("detects prix barré via compare-at", () => {
    expect(hasCompareAtPromo(149, 199)).toBe(true);
    expect(hasCompareAtPromo(199, 199)).toBe(false);
  });

  it("splits lines and prefers price reason first", () => {
    const { allowed, excluded } = splitReturnableByEligibility([
      { unitAmount: 100, currencyCode: "CHF" },
      { unitAmount: 700, currencyCode: "CHF", delivery48h: "true" },
      { unitAmount: 180, currencyCode: "CHF", collectionHandles: ["soldes"] },
    ]);
    expect(allowed).toHaveLength(1);
    expect(excluded.map((e) => e.excludeReason)).toEqual(["PRICE_OVER_LIMIT", "SALE_OR_PROMO"]);
    expect(resolveReturnExcludeReason({ unitAmount: 700, currencyCode: "CHF", delivery48h: "true" })).toBe(
      "PRICE_OVER_LIMIT"
    );
  });
});
