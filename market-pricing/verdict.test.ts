import { describe, expect, it } from "vitest";
import { aggregateMarket } from "@/market-pricing/aggregate";
import { cashMarginAt, decideVerdict, floorInclFromExVatSell } from "@/market-pricing/verdict";
import type { MarketOffer, SourceResult } from "@/market-pricing/types";

function offer(p: Partial<MarketOffer>): MarketOffer {
  return {
    source: "google_shopping",
    seller: "Rival",
    priceChf: 200,
    totalChf: null,
    availability: "in_stock",
    productUrl: null,
    isSelf: false,
    observedAt: "2026-10-19T00:00:00Z",
    ...p,
  };
}

function result(offers: MarketOffer[], shopCount: number | null = null): SourceResult {
  return { source: "google_shopping", ok: true, offers, shopCount };
}

describe("aggregateMarket", () => {
  it("excludes self offers and dedupes shop+price", () => {
    const agg = aggregateMarket([
      result([
        offer({ seller: "Galaxus", priceChf: 189 }),
        offer({ seller: "Galaxus", priceChf: 189 }), // dup
        offer({ seller: "Microspot", priceChf: 199 }),
        offer({ seller: "Resell Lausanne", priceChf: 150, isSelf: true }),
      ]),
    ]);
    expect(agg.rivalOfferCount).toBe(2);
    expect(agg.minChf).toBe(189);
    expect(agg.maxChf).toBe(199);
    expect(agg.medianChf).toBe(194);
    expect(agg.cheapestSeller).toBe("Galaxus");
  });

  it("computes sold-out ratio over known-availability rivals only", () => {
    const agg = aggregateMarket([
      result([
        offer({ seller: "A", priceChf: 100, availability: "out_of_stock" }),
        offer({ seller: "B", priceChf: 110, availability: "in_stock" }),
        offer({ seller: "C", priceChf: 120, availability: "unknown" }),
      ]),
    ]);
    expect(agg.soldOutRatio).toBeCloseTo(0.5, 5);
  });
});

describe("decideVerdict", () => {
  const cost = 150; // ex VAT
  const floorIncl = floorInclFromExVatSell(calcFloor(cost));

  function calcFloor(c: number): number {
    // mirror STX locked denom: (c + 1.6) / (1 - 0.023 - 0.10)
    return Math.ceil(((c + 1.6) / (1 - 0.023 - 0.1)) * 100 - 1e-12) / 100;
  }

  it("flags below-floor risk when market is under the floor", () => {
    const agg = aggregateMarket([
      result([offer({ priceChf: 170 }), offer({ seller: "X", priceChf: 175 })]),
    ]);
    const v = decideVerdict({
      market: agg,
      ourPriceInclChf: floorIncl,
      floorInclChf: floorIncl,
      supplierCostExVatChf: cost,
    });
    expect(v.code).toBe("BELOW_FLOOR_RISK");
    expect(v.suggestedPriceChf).toBeNull();
  });

  it("suggests a cut when we are above market and cut stays above floor", () => {
    const agg = aggregateMarket([
      result([offer({ priceChf: 240 }), offer({ seller: "X", priceChf: 250 })]),
    ]);
    const v = decideVerdict({
      market: agg,
      ourPriceInclChf: 300,
      floorInclChf: floorIncl,
      supplierCostExVatChf: cost,
    });
    expect(v.code).toBe("CUT_TO_MARKET");
    expect(v.suggestedPriceChf).not.toBeNull();
    expect(v.suggestedPriceChf!).toBeGreaterThanOrEqual(floorIncl!);
    expect(v.suggestedPriceChf!).toBeLessThan(300);
  });

  it("returns NO_MARKET_DATA below the minimum rival count", () => {
    const agg = aggregateMarket([result([offer({ priceChf: 240 })])]);
    const v = decideVerdict({
      market: agg,
      ourPriceInclChf: 260,
      floorInclChf: floorIncl,
      supplierCostExVatChf: cost,
    });
    expect(v.code).toBe("NO_MARKET_DATA");
  });
});

describe("cashMarginAt", () => {
  it("keeps the VAT gift and charges saldo + box", () => {
    // 180 incl: 180*0.979 - 150 - 1.6 = 24.62 → /180 = 0.1368
    const m = cashMarginAt(180, 150);
    expect(m).toBeCloseTo((180 * 0.979 - 150 - 1.6) / 180, 4);
  });
});
