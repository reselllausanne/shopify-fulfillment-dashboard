import { describe, expect, it } from "vitest";
import { calcSuggestedRetailFromStoredStxBuyPrice } from "@/galaxus/pricing/suggestedSellPrice";
import {
  computeDecathlonOfferListPriceFromBuyNowForSupplier,
  computeDecathlonStxOfferListPrice,
  isDecathlonStxListableBuy,
} from "../pricing";

describe("STX pricing (website margin + 400 cap)", () => {
  it("matches website suggested retail for stored STX buy", () => {
    const buy = 106.47;
    const expected = calcSuggestedRetailFromStoredStxBuyPrice({
      storedBuyPriceChf: buy,
      deliveryType: "express_standard",
    });
    expect(computeDecathlonStxOfferListPrice(buy, undefined, { deliveryType: "express_standard" })).toBe(
      expected
    );
    expect(expected).toBe(149);
  });

  it("buy 180 is listable under 400 cap", () => {
    expect(
      computeDecathlonStxOfferListPrice(180.44, undefined, { deliveryType: "express_standard" })
    ).toBe(269);
    expect(isDecathlonStxListableBuy(180.44, { deliveryType: "express_standard" })).toBe(true);
  });

  it("high buy excluded when website list exceeds 400", () => {
    expect(computeDecathlonStxOfferListPrice(300)).toBeNull();
    expect(isDecathlonStxListableBuy(300)).toBe(false);
  });

  it("never lists above 400 CHF", () => {
    for (const buy of [25, 55, 106, 140, 180, 280]) {
      const list = computeDecathlonStxOfferListPrice(buy);
      if (list != null) expect(list).toBeLessThanOrEqual(400);
    }
  });

  it("STX supplier path uses website margin only", () => {
    const stx = computeDecathlonOfferListPriceFromBuyNowForSupplier(106.47, "stx", undefined, {
      deliveryType: "express_standard",
    });
    expect(stx).toBe(computeDecathlonStxOfferListPrice(106.47, undefined, { deliveryType: "express_standard" }));
  });
});
