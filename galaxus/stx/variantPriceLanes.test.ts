import { describe, expect, it } from "vitest";
import { selectStxStandardOffer } from "@/galaxus/stx/offerSelection";
import { buildStxDualPriceFields } from "@/galaxus/stx/variantPriceLanes";

describe("selectStxStandardOffer", () => {
  it("picks cheapest standard lane", () => {
    const selected = selectStxStandardOffer([
      { type: "standard", price: 380, asks: 3 },
      { type: "standard", price: 375, asks: 21 },
      { type: "express_standard", price: 410, asks: 9 },
    ]);
    expect(selected).toEqual({ deliveryType: "standard", price: 375, asks: 21 });
  });
});

describe("buildStxDualPriceFields", () => {
  const payload = { slug: "lego-lion-knights-castle-set-10305", title: "LEGO Castle" };
  const prices = [
    { type: "express_expedited", price: 410, asks: 7 },
    { type: "express_standard", price: 410, asks: 9 },
    { type: "standard", price: 375, asks: 21 },
  ];

  it("stores both lanes for LEGO with 60 inbound ship on large set", () => {
    const lanes = buildStxDualPriceFields({ prices }, payload, "LEGO Castle", {
      slug: payload.slug,
    });
    expect(lanes).not.toBeNull();
    expect(lanes!.expressBuyPrice).toBeCloseTo(513.65, 1);
    expect(lanes!.standardBuyPrice).toBeCloseTo(474.94, 1);
    expect(lanes!.price).toBe(lanes!.expressBuyPrice);
    expect(lanes!.deliveryType).toBe("express_expedited");
  });
});
