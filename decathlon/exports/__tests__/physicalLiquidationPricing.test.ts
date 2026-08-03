import { describe, expect, it } from "vitest";
import {
  decathlonListPriceFromTargetPayout,
  decathlonPhysicalLiquidationFeeRates,
} from "../physicalLiquidationPricing";
import { decathlonEstimatedPayoutFromSellTtc } from "@/decathlon/orders/margin";

describe("physical liquidation Decathlon pricing", () => {
  it("grosses up payout so Mirakl list keeps ~0.75 net", () => {
    const rates = decathlonPhysicalLiquidationFeeRates();
    expect(rates.payoutRate).toBeCloseTo(0.75, 5);

    const payout = 129.9;
    const list = decathlonListPriceFromTargetPayout(payout);
    expect(list).toBe(173.2);

    const back = decathlonEstimatedPayoutFromSellTtc(list!);
    expect(back).toBeCloseTo(payout, 1);
  });

  it("rejects non-positive payout", () => {
    expect(decathlonListPriceFromTargetPayout(0)).toBeNull();
    expect(decathlonListPriceFromTargetPayout(-10)).toBeNull();
    expect(decathlonListPriceFromTargetPayout(Number.NaN)).toBeNull();
  });
});
