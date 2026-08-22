import { describe, expect, it } from "vitest";
import {
  computeDecathlonOfferListPriceFromBuyNow,
  computeDecathlonOfferListPriceFromBuyNowForSupplier,
} from "../pricing";

describe("own-catalog Decathlon list (margin then /0.75)", () => {
  it("SNL applies feed gross-up on top of margin-on-buy", () => {
    const buy = 62.9;
    const base = computeDecathlonOfferListPriceFromBuyNow(buy, { marginOnBuy: 0.12 });
    expect(base).toBe(110.52);
    const list = computeDecathlonOfferListPriceFromBuyNowForSupplier(buy, "snl", {
      marginOnBuy: 0.12,
    });
    expect(list).toBe(147.36);
    expect(list).toBe(Math.round((base! / 0.75) * 100) / 100);
  });

  it("default 15% margin path also gets /0.75", () => {
    const buy = 62.9;
    const base = computeDecathlonOfferListPriceFromBuyNow(buy, { marginOnBuy: 0.15 });
    const list = computeDecathlonOfferListPriceFromBuyNowForSupplier(buy, "snl", {
      marginOnBuy: 0.15,
    });
    expect(base).toBe(113.02);
    expect(list).toBe(150.69);
  });

  it("THE stays on loss path even when listed as partner key", () => {
    const list = computeDecathlonOfferListPriceFromBuyNowForSupplier(
      100,
      "the",
      { targetLossFraction: 0.15 },
      undefined,
      new Set(["the"])
    );
    // loss path — not buy/0.75 (133.33)
    expect(list).not.toBe(133.33);
    expect(list).toBeTruthy();
  });

  it("NER stays buy/0.75 only (no double gross-up)", () => {
    expect(computeDecathlonOfferListPriceFromBuyNowForSupplier(100, "ner")).toBe(133.33);
  });

  it("partner keys stay buy/0.75 only", () => {
    expect(
      computeDecathlonOfferListPriceFromBuyNowForSupplier(100, "flo", undefined, undefined, new Set(["flo"]))
    ).toBe(133.33);
  });
});
