import { describe, expect, it } from "vitest";
import {
  computeExlibrisLandedCost,
  parseExlibrisLeadTime,
} from "@/app/lib/exlibrisPricing";

describe("computeExlibrisLandedCost", () => {
  it("portofrei + 30% above CHF 9.90", () => {
    const cost = computeExlibrisLandedCost({
      buyChf: 19.9,
      availabilityText: "Sofort versandbereit",
    });
    expect(cost?.shippingChf).toBe(0);
    expect(cost?.shippingReason).toBe("portofrei");
    expect(cost?.sellPriceChf).toBe(25.87);
    expect(cost?.dispatchDaysMin).toBe(0);
  });

  it("adds CHF 5 Kleinmengenzuschlag under 9.90 and applies abs floor", () => {
    const cost = computeExlibrisLandedCost({ buyChf: 1.9 });
    expect(cost?.shippingChf).toBe(5);
    expect(cost?.landedChf).toBe(6.9);
    expect(cost?.marginMode).toBe("min_abs_floor");
    expect(cost?.sellPriceChf).toBe(9.9);
  });
});

describe("parseExlibrisLeadTime", () => {
  it("parses 6–8 Werktage dispatch", () => {
    const lead = parseExlibrisLeadTime(
      "Auslieferung erfolgt in der Regel innert 6 bis 8 Werktagen."
    );
    expect(lead.dispatchDaysMin).toBe(6);
    expect(lead.dispatchDaysMax).toBe(8);
    expect(lead.doorDaysMax).toBe(11);
  });
});
