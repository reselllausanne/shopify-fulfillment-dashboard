import { describe, expect, it } from "vitest";
import { decathlonEstimatedPayoutFromSellTtc } from "@/decathlon/orders/margin";
import {
  computeDecathlonOfferListPriceFromBuyNowForSupplier,
  computeDecathlonOfferListPriceFromMarginOnBuy,
  computeDecathlonStxOfferListPrice,
  DECATHLON_FIXED_COST_CHF,
  DEFAULT_DECATHLON_STX_MARGIN_ON_BUY,
  isDecathlonStxListableBuy,
} from "../pricing";

describe("STX pricing (fee-aware 40% after fees + 400 cap)", () => {
  it("lists at 40% margin on buy after commission + VAT + fulfil", () => {
    const buy = 106.47;
    const expected = computeDecathlonOfferListPriceFromMarginOnBuy(buy, {
      marginOnBuy: DEFAULT_DECATHLON_STX_MARGIN_ON_BUY,
    });
    expect(computeDecathlonStxOfferListPrice(buy)).toBe(expected);
    expect(expected).toBeGreaterThan(149);
    const payout = decathlonEstimatedPayoutFromSellTtc(expected!);
    expect(payout).toBeTruthy();
    const pocket = payout! - buy - DECATHLON_FIXED_COST_CHF;
    expect(pocket).toBeGreaterThan(buy * 0.35);
  });

  it("buy 180 is listable under 400 cap", () => {
    const list = computeDecathlonStxOfferListPrice(180.44);
    expect(list).toBe(
      computeDecathlonOfferListPriceFromMarginOnBuy(180.44, {
        marginOnBuy: DEFAULT_DECATHLON_STX_MARGIN_ON_BUY,
      })
    );
    expect(list).toBeLessThanOrEqual(400);
    expect(isDecathlonStxListableBuy(180.44)).toBe(true);
  });

  it("high buy excluded when fee-aware list exceeds 400", () => {
    expect(computeDecathlonStxOfferListPrice(300)).toBeNull();
    expect(isDecathlonStxListableBuy(300)).toBe(false);
  });

  it("never lists above 400 CHF", () => {
    for (const buy of [25, 55, 106, 140, 180, 280]) {
      const list = computeDecathlonStxOfferListPrice(buy);
      if (list != null) expect(list).toBeLessThanOrEqual(400);
    }
  });

  it("STX supplier path uses fee-aware margin, not website retail", () => {
    const stx = computeDecathlonOfferListPriceFromBuyNowForSupplier(106.47, "stx");
    expect(stx).toBe(computeDecathlonStxOfferListPrice(106.47));
    expect(stx).not.toBe(149);
  });
});
