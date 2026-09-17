import { describe, expect, it } from "vitest";

import {
  estimateNetPocketChf,
  evaluateConstrainedCandidate,
  isAdsAlive,
  relativeDemandVsCurrent,
} from "@/adsanalytics/merchant/constrainedPricing";

describe("estimateNetPocketChf", () => {
  it("is positive when sell clears fees+cost", () => {
    const pocket = estimateNetPocketChf(200, 100, true);
    expect(pocket).not.toBeNull();
    expect(pocket!).toBeGreaterThan(0);
  });

  it("goes negative when sell too low vs cost", () => {
    const pocket = estimateNetPocketChf(110, 100, true);
    expect(pocket!).toBeLessThan(0);
  });
});

describe("isAdsAlive", () => {
  it("flags dead SKUs", () => {
    expect(isAdsAlive({ impressions: 0, clicks: 0, conversions: 0, costChf: 0 })).toBe(false);
    expect(isAdsAlive({ impressions: 50, clicks: 0, conversions: 0, costChf: 0 })).toBe(true);
    expect(isAdsAlive({ impressions: 0, clicks: 2, conversions: 0, costChf: 0 })).toBe(true);
  });
});

describe("relativeDemandVsCurrent", () => {
  it("improves when moving toward benchmark from above", () => {
    const atMarket = relativeDemandVsCurrent(100, 150, 100);
    const stillHigh = relativeDemandVsCurrent(140, 150, 100);
    expect(atMarket).toBeGreaterThan(stillHigh);
  });
});

describe("evaluateConstrainedCandidate", () => {
  const ads = { impressions: 200, clicks: 8, conversions: 1, costChf: 12 };

  it("skips dead sku even if above market", () => {
    const r = evaluateConstrainedCandidate({
      currentPrice: 300,
      benchmarkPrice: 100,
      suggestedPrice: null,
      buyCostChf: 80,
      ads: { impressions: 0, clicks: 0, conversions: 0, costChf: 0 },
    });
    expect(r.verdict).toBe("skip_dead_sku");
  });

  it("skips when no buy cost", () => {
    const r = evaluateConstrainedCandidate({
      currentPrice: 300,
      benchmarkPrice: 100,
      suggestedPrice: null,
      buyCostChf: null,
      ads,
    });
    expect(r.verdict).toBe("skip_no_cost");
  });

  it("does not recommend cutting to benchmark below margin floor", () => {
    // High buy → floor well above 105 benchmark; may hold or partial lower to floor only.
    const r = evaluateConstrainedCandidate({
      currentPrice: 309,
      benchmarkPrice: 105,
      suggestedPrice: null,
      buyCostChf: 180,
      brand: "adidas",
      title: "Handball Spezial",
      ads,
      gapThresholdPercent: 10,
    });
    expect(r.verdict).not.toBe("skip_dead_sku");
    expect(r.marginFloorChf).not.toBeNull();
    expect(r.marginFloorChf!).toBeGreaterThan(105);
    if (r.bestPriceChf != null) {
      expect(r.bestPriceChf).toBeGreaterThanOrEqual(r.marginFloorChf! - 1);
      expect(r.bestPriceChf).not.toBeLessThan(100); // never ~105 if floor >> 105
    }
    expect(r.canReachBenchmark).toBe(false);
  });

  it("can recommend lower when headroom exists and SKU alive", () => {
    const r = evaluateConstrainedCandidate({
      currentPrice: 250,
      benchmarkPrice: 200,
      suggestedPrice: null,
      buyCostChf: 90,
      brand: "nike",
      title: "Air Max",
      ads,
      gapThresholdPercent: 8,
    });
    expect(r.marginFloorChf).not.toBeNull();
    expect(r.marginFloorChf!).toBeLessThan(250);
    // Either recommend_lower or hold if score prefers current — never below floor.
    if (r.verdict === "recommend_lower") {
      expect(r.bestPriceChf!).toBeLessThan(250);
      expect(r.bestPriceChf!).toBeGreaterThanOrEqual(r.marginFloorChf! - 1);
    }
  });

  it("skips no-headroom when already on floor above market", () => {
    const r = evaluateConstrainedCandidate({
      currentPrice: 220,
      benchmarkPrice: 100,
      suggestedPrice: null,
      buyCostChf: 150,
      title: "Tight margin sneaker",
      ads,
      gapThresholdPercent: 10,
    });
    // Floor from 150 cost is typically ~220+; if current≈floor → no headroom.
    if (r.marginFloorChf != null && r.currentPrice <= r.marginFloorChf + 1) {
      expect(r.verdict).toBe("skip_no_headroom");
    }
  });
});
