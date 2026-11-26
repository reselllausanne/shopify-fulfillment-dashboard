import { describe, expect, it } from "vitest";
import { pickBuyChf, quoteForVariant, quoteFromRawVariant } from "@/app/lib/tvLiveBuy";
import { restateStoredBuyChf, stockxAllInChf } from "@/app/lib/stockxAllIn";
import { estimatedStockxBuyChfFromList } from "@/galaxus/stx/chfStockxBuyPrice";

const product = { url_key: "nike-air-max-95-se", title: "Nike Air Max 95 SE" };

describe("stockxAllInChf", () => {
  it("matches real StockX checkouts (ask * 1.075 + 20)", () => {
    expect(stockxAllInChf(123)).toBe(152.23);
    expect(stockxAllInChf(98)).toBe(125.35);
    expect(stockxAllInChf(166)).toBe(198.45);
    expect(stockxAllInChf(104)).toBe(131.8);
    expect(stockxAllInChf(79)).toBeCloseTo(104.92, 1);
  });

  it("matches the Discord comparator for #7843 and #7844", () => {
    expect(stockxAllInChf(126)).toBe(155.45);
    expect(stockxAllInChf(143)).toBe(173.73);
  });

  it("unwinds a legacy stored price back to the real all-in", () => {
    const stored = estimatedStockxBuyChfFromList(126, 20);
    expect(restateStoredBuyChf(stored)).toBe(155.45);
  });
});

describe("quoteFromRawVariant", () => {
  it("returns both lanes", () => {
    const q = quoteFromRawVariant(
      {
        prices: [
          { type: "standard", price: 126, asks: 13 },
          { type: "express_shipped", price: 143, asks: 6 },
        ],
      },
      product,
      null
    );
    expect(q).toEqual({ standardChf: 155.45, expressChf: 173.73 });
  });
});

describe("quoteForVariant", () => {
  const variants = [
    { size: "9", prices: [{ type: "standard", price: 100, asks: 3 }] },
    { size: "10", prices: [] },
    { size: "12", prices: [{ type: "standard", price: 140, asks: 2 }] },
  ];

  it("uses the exact size when it has an ask", () => {
    expect(quoteForVariant(variants, 0, product)).toEqual({
      standardChf: stockxAllInChf(100),
      expressChf: null,
      extrapolated: false,
    });
  });

  it("borrows the closest priced size when the size has no ask", () => {
    expect(quoteForVariant(variants, 1, product)).toEqual({
      standardChf: stockxAllInChf(100),
      expressChf: null,
      extrapolated: true,
    });
  });

  it("returns null when nothing is priced", () => {
    expect(quoteForVariant([{ size: "9", prices: [] }], 0, product)).toBeNull();
  });
});

describe("pickBuyChf", () => {
  const quote = { standardChf: 155.45, expressChf: 173.73, extrapolated: false };
  it("picks the lane of the order and falls back to the other one", () => {
    expect(pickBuyChf(quote, false)).toBe(155.45);
    expect(pickBuyChf(quote, true)).toBe(173.73);
    expect(pickBuyChf({ ...quote, expressChf: null }, true)).toBe(155.45);
    expect(pickBuyChf(null, false)).toBeUndefined();
  });
});
