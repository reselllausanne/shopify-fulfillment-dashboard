import { describe, expect, it } from "vitest";
import {
  computeAlternateLandedCost,
  ALTERNATE_PACKAGE_SHIP_CHF,
} from "@/app/lib/alternatePricing";

describe("alternatePricing", () => {
  it("flat CHF 16 package + 20% margin", () => {
    const cost = computeAlternateLandedCost(33.99);
    expect(cost).not.toBeNull();
    expect(cost!.shippingChf).toBe(ALTERNATE_PACKAGE_SHIP_CHF);
    expect(cost!.landedChf).toBe(49.99);
    expect(cost!.marginPercent).toBe(20);
    expect(cost!.sellPriceChf).toBe(Math.round(49.99 * 1.2 * 100) / 100);
  });

  it("still adds CHF 16 on expensive items (MOQ 1)", () => {
    const cost = computeAlternateLandedCost(500);
    expect(cost!.shippingChf).toBe(16);
    expect(cost!.landedChf).toBe(516);
    expect(cost!.sellPriceChf).toBe(Math.round(516 * 1.2 * 100) / 100);
  });
});
