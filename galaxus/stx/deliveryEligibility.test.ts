import { describe, expect, it } from "vitest";
import {
  resolveStxDeliveryEligibility,
} from "@/galaxus/stx/deliveryEligibility";

describe("resolveStxDeliveryEligibility", () => {
  const express = { deliveryType: "express_standard" as const, price: 900, asks: 2 };
  const standard = { deliveryType: "standard" as const, price: 200, asks: 8 };

  it("keeps catalogue when demoting express→standard by price cap", () => {
    const e = resolveStxDeliveryEligibility({
      express,
      standard,
      preferStandardByPriceCap: true,
    });
    expect(e.expressEligible).toBe(true);
    expect(e.standardEligible).toBe(true);
    expect(e.catalogueEligible).toBe(true);
    expect(e.activeDeliveryType).toBe("standard");
    expect(e.laneReason).toBe("express_over_standard_cap");
  });

  it("keeps express when standard has price but asks=0 (not sellable)", () => {
    const e = resolveStxDeliveryEligibility({
      express,
      standard: { deliveryType: "standard", price: 200, asks: 0 },
      preferStandardByPriceCap: true,
    });
    expect(e.standardEligible).toBe(false);
    expect(e.catalogueEligible).toBe(true);
    expect(e.activeDeliveryType).toBe("express_standard");
    expect(e.laneReason).toBe("express_only");
  });

  it("does not confuse zero stock with lane change — no catalogue when both unsellable", () => {
    const e = resolveStxDeliveryEligibility({
      express: { deliveryType: "express_standard", price: 100, asks: 0 },
      standard: { deliveryType: "standard", price: 80, asks: 0 },
      preferStandardByPriceCap: false,
    });
    expect(e.catalogueEligible).toBe(false);
    expect(e.laneReason).toBe("none");
  });
});
