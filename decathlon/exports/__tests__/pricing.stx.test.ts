import { describe, expect, it } from "vitest";
import {
  computeDecathlonOfferListPriceFromBuyNowForSupplier,
  computeDecathlonStxOfferListPrice,
  isDecathlonStxListableBuy,
  resolveDecathlonStxSellTierForBuy,
} from "../pricing";

describe("STX tier pricing (safe max buy per sell tier)", () => {
  it("buy 106 → sell 200 (safe max 110 at 200 tier)", () => {
    expect(computeDecathlonStxOfferListPrice(106)).toBe(200);
    expect(computeDecathlonStxOfferListPrice(106.47)).toBe(200);
  });

  it("buy 110 → sell 200 (exact safe max at 200 tier)", () => {
    expect(computeDecathlonStxOfferListPrice(110)).toBe(200);
  });

  it("buy 111 → sell 210", () => {
    expect(computeDecathlonStxOfferListPrice(111)).toBe(210);
  });

  it("buy 155 → sell 250 (top tier safe max)", () => {
    expect(computeDecathlonStxOfferListPrice(155)).toBe(250);
  });

  it("buy 156 → not listable (above safe max at 250 tier)", () => {
    expect(computeDecathlonStxOfferListPrice(156)).toBeNull();
    expect(isDecathlonStxListableBuy(156)).toBe(false);
  });

  it("cheap buy 25 → sell 100", () => {
    expect(computeDecathlonStxOfferListPrice(25)).toBe(100);
  });

  it("buy 55 → lowest tier with safe max ≥ 55 is 140", () => {
    expect(resolveDecathlonStxSellTierForBuy(55)?.sellTtc).toBe(140);
    expect(computeDecathlonStxOfferListPrice(55)).toBe(140);
  });

  it("never lists above 250 CHF", () => {
    const list = computeDecathlonStxOfferListPrice(155);
    expect(list).not.toBeNull();
    expect(list!).toBeLessThanOrEqual(250);
  });

  it("STX supplier path uses tier pricing", () => {
    const stx = computeDecathlonOfferListPriceFromBuyNowForSupplier(106.47, "stx");
    expect(stx).toBe(computeDecathlonStxOfferListPrice(106.47));
  });
});
