import { describe, expect, it } from "vitest";
import { computeBaechliLandedCost } from "@/app/lib/baechliPricing";

describe("baechliPricing", () => {
  it("Mindermenge under 75 + 20% margin", () => {
    const cost = computeBaechliLandedCost(50);
    expect(cost!.shippingChf).toBe(7.5);
    expect(cost!.landedChf).toBe(57.5);
    expect(cost!.marginPercent).toBe(20);
    expect(cost!.sellPriceChf).toBe(Math.round(57.5 * 1.2 * 100) / 100);
  });

  it("free ship at/above 75 + 20%", () => {
    const cost = computeBaechliLandedCost(75);
    expect(cost!.shippingChf).toBe(0);
    expect(cost!.sellPriceChf).toBe(90);
  });
});
