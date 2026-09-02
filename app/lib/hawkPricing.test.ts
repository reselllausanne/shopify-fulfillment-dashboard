import { describe, expect, it } from "vitest";
import { computeHawkLandedCost } from "@/app/lib/hawkPricing";

describe("hawkPricing", () => {
  it("flat CHF 9 + 20% margin", () => {
    const cost = computeHawkLandedCost(59.96);
    expect(cost).not.toBeNull();
    expect(cost!.shippingChf).toBe(9);
    expect(cost!.landedChf).toBe(68.96);
    expect(cost!.marginPercent).toBe(20);
    expect(cost!.sellPriceChf).toBe(Math.round(68.96 * 1.2 * 100) / 100);
  });

  it("still adds CHF 9 on expensive items", () => {
    const cost = computeHawkLandedCost(990);
    expect(cost!.shippingChf).toBe(9);
    expect(cost!.sellPriceChf).toBe(Math.round(999 * 1.2 * 100) / 100);
  });
});
