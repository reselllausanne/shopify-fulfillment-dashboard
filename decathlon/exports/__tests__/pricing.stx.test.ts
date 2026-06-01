import { describe, expect, it } from "vitest";
import {
  computeDecathlonOfferListPriceFromBuyNowForSupplier,
  computeDecathlonStxOfferListPrice,
  computeDecathlonRetainedRate,
} from "../pricing";

describe("STX pricing (20% on buy + 13 fixed)", () => {
  it("Nike-like buy ~106 follows simple formula", () => {
    const buy = 106.47;
    const list = computeDecathlonStxOfferListPrice(buy);
    const expected = (buy * 1.2 + 13) / computeDecathlonRetainedRate({});
    expect(list).not.toBeNull();
    expect(list!).toBeCloseTo(expected, 2);
  });

  it("cheap buy also follows same formula", () => {
    const list = computeDecathlonStxOfferListPrice(55)!;
    const expected = (55 * 1.2 + 13) / computeDecathlonRetainedRate({});
    expect(list).toBeCloseTo(expected, 2);
  });

  it("STX supplier path uses STX margin only", () => {
    const stx = computeDecathlonOfferListPriceFromBuyNowForSupplier(106.47, "stx");
    expect(stx).toBe(computeDecathlonStxOfferListPrice(106.47));
  });
});
