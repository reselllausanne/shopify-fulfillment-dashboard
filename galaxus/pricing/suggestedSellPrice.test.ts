import { describe, expect, it } from "vitest";
import {
  calcSuggestedSellPrice,
  classifySuggestedSellCategory,
  deriveStockxRawAskFromStoredBuyPrice,
  getLegoInboundShippingChf,
  marginPct,
  psychRoundUp,
} from "@/galaxus/pricing/suggestedSellPrice";
import { estimatedStockxBuyChfFromList } from "@/galaxus/stx/chfStockxBuyPrice";

describe("psychRoundUp", () => {
  it("rounds to psychological endings", () => {
    expect(psychRoundUp(218.4)).toBe(219);
    expect(psychRoundUp(155.3)).toBe(159);
    expect(psychRoundUp(90)).toBe(99);
  });
});

describe("getLegoInboundShippingChf", () => {
  it("matches handle tiers", () => {
    expect(getLegoInboundShippingChf("lego-pet-shop-set-10218")).toBe(45);
    expect(getLegoInboundShippingChf("lego-titanic-set-10294")).toBe(60);
    expect(getLegoInboundShippingChf("lego-star-wars-tie-fighter-set-75095")).toBe(35);
    expect(getLegoInboundShippingChf("lego-random-set")).toBe(20);
  });
});

describe("marginPct", () => {
  it("picks sneaker bands", () => {
    expect(marginPct(60, "sneakers")).toBe(20);
    expect(marginPct(100, "sneakers")).toBe(45);
    expect(marginPct(200, "sneakers")).toBe(35);
    expect(marginPct(500, "sneakers")).toBe(30);
    expect(marginPct(2000, "sneakers")).toBe(27);
  });

  it("picks clothing bands", () => {
    expect(marginPct(100, "clothing")).toBe(45);
    expect(marginPct(200, "clothing")).toBe(40);
  });

  it("uses flat lego margin", () => {
    expect(marginPct(50, "lego")).toBe(33);
    expect(marginPct(5000, "lego")).toBe(33);
  });
});

describe("classifySuggestedSellCategory", () => {
  it("detects lego", () => {
    expect(classifySuggestedSellCategory({ productHandle: "lego-titanic-set-10294" })).toBe("lego");
  });

  it("detects clothing", () => {
    expect(classifySuggestedSellCategory({ productName: "Supreme Box Logo Hoodie" })).toBe("clothing");
  });

  it("defaults to sneakers", () => {
    expect(classifySuggestedSellCategory({ productName: "Air Jordan 1 Low" })).toBe("sneakers");
  });
});

describe("calcSuggestedSellPrice validation examples", () => {
  const withinTen = (actual: number, expected: number) => {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(10);
  };

  it("matches sneaker examples", () => {
    withinTen(calcSuggestedSellPrice({ stockxRaw: 60, category: "sneakers" }), 149);
    withinTen(calcSuggestedSellPrice({ stockxRaw: 100, category: "sneakers" }), 199);
    withinTen(calcSuggestedSellPrice({ stockxRaw: 200, category: "sneakers" }), 329);
    withinTen(calcSuggestedSellPrice({ stockxRaw: 600, category: "sneakers" }), 879);
    withinTen(calcSuggestedSellPrice({ stockxRaw: 2000, category: "sneakers" }), 2779);
  });

  it("matches clothing examples", () => {
    withinTen(calcSuggestedSellPrice({ stockxRaw: 100, category: "clothing" }), 199);
    withinTen(calcSuggestedSellPrice({ stockxRaw: 200, category: "clothing" }), 349);
  });

  it("matches lego examples", () => {
    withinTen(
      calcSuggestedSellPrice({ stockxRaw: 100, category: "lego", productHandle: "lego-set-123" }),
      189
    );
    withinTen(
      calcSuggestedSellPrice({ stockxRaw: 200, category: "lego", productHandle: "lego-set-123" }),
      329
    );
  });

  it("covers one point per sneaker band", () => {
    const bands = [40, 90, 140, 220, 340, 500, 750, 1100, 2200, 3500];
    for (const raw of bands) {
      expect(calcSuggestedSellPrice({ stockxRaw: raw, category: "sneakers" })).toBeGreaterThan(0);
    }
  });
});

describe("deriveStockxRawAskFromStoredBuyPrice", () => {
  it("round-trips stored buy price", () => {
    const raw = 200;
    const stored = estimatedStockxBuyChfFromList(raw, 20);
    const derived = deriveStockxRawAskFromStoredBuyPrice(stored, { slug: "air-jordan-1" });
    expect(derived).not.toBeNull();
    expect(derived!).toBeGreaterThan(199);
    expect(derived!).toBeLessThan(201);
  });
});
