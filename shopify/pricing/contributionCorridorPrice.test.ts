import { describe, expect, it } from "vitest";
import {
  adsShareAtSellPrice,
  quoteContributionCorridor,
  remainingMarginRate,
} from "@/shopify/pricing/contributionCorridorPrice";

describe("hybrid contribution corridor", () => {
  it("puts about 14% ads on a 220 CHF pair and about 11% on a 400 CHF pair", () => {
    const atAov = adsShareAtSellPrice(220);
    const at400 = adsShareAtSellPrice(400);
    expect(atAov).toBeCloseTo(0.1391, 3);
    expect(at400).toBeCloseTo(0.1125, 3);
    expect(at400!).toBeLessThan(atAov!);
  });

  it("keeps 8–10% on a fixed StockX buy after fees, VAT and hybrid ads", () => {
    const quote = quoteContributionCorridor({ sourceCostChf: 150 });
    expect(quote!.decision).toBe("target");
    expect(quote!.remainingMarginRate).toBeGreaterThanOrEqual(0.08);
    expect(quote!.remainingMarginRate).toBeLessThanOrEqual(0.11);
    expect(quote!.sellChf).toBeGreaterThan(150);
  });

  it("matches the benchmark only inside the margin band", () => {
    const bare = quoteContributionCorridor({ sourceCostChf: 150 });
    const matched = quoteContributionCorridor({
      sourceCostChf: 150,
      benchmarkChf: bare!.targetChf,
    });
    expect(matched!.decision).toBe("match_benchmark");
    expect(matched!.sellChf).toBe(bare!.targetChf);
  });

  it("does not undercut the 8% floor when the market is cheaper", () => {
    const quote = quoteContributionCorridor({ sourceCostChf: 150, benchmarkChf: 100 });
    expect(quote!.decision).toBe("margin_floor");
    expect(quote!.sellChf).toBe(quote!.floorChf);
    expect(remainingMarginRate(quote!.sellChf, 150)).toBeGreaterThanOrEqual(0.08);
  });

  it("does not price above the 10% cap when the market is richer", () => {
    const quote = quoteContributionCorridor({ sourceCostChf: 150, benchmarkChf: 900 });
    expect(quote!.decision).toBe("margin_cap");
    expect(quote!.sellChf).toBe(quote!.capChf);
  });
});
