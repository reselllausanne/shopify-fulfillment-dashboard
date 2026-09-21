import { describe, expect, it } from "vitest";
import { computeHawkLandedCost } from "@/app/lib/hawkPricing";

describe("hawkPricing", () => {
  it("flat CHF 9 + 30% margin", () => {
    const cost = computeHawkLandedCost(59.96);
    expect(cost).not.toBeNull();
    expect(cost!.shippingChf).toBe(9);
    expect(cost!.landedChf).toBe(68.96);
    expect(cost!.marginPercent).toBe(30);
    expect(cost!.sellPriceChf).toBe(Math.round(68.96 * 1.3 * 100) / 100);
  });

  it("still adds CHF 9 on expensive items", () => {
    const cost = computeHawkLandedCost(990);
    expect(cost!.shippingChf).toBe(9);
    expect(cost!.sellPriceChf).toBe(Math.round(999 * 1.3 * 100) / 100);
  });

  it("cheap buy under 10 gets +5 abs floor", () => {
    const cost = computeHawkLandedCost(8);
    expect(cost!.landedChf).toBe(17);
    // 17*1.3=22.1; floor 17+5=22 → 22.1 wins
    expect(cost!.sellPriceChf).toBe(22.1);
  });
});
