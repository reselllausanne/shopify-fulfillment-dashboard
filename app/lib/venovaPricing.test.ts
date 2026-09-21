import { describe, expect, it, afterEach } from "vitest";
import {
  computeVenovaSellPrice,
  resolveVenovaShippingChf,
  venovaPricingConfig,
} from "@/app/lib/venovaPricing";

describe("venova shipping + margin", () => {
  const prevMargin = process.env.SCRAPER_VEN_MARGIN_PERCENT;
  const prevShip = process.env.SCRAPER_VEN_SHIPPING_CHF;
  const prevSkip = process.env.SCRAPER_VEN_SKIP_OVER_30KG;
  const prevBulky = process.env.SCRAPER_VEN_BULKY_SHIPPING_CHF;

  afterEach(() => {
    for (const [k, v] of [
      ["SCRAPER_VEN_MARGIN_PERCENT", prevMargin],
      ["SCRAPER_VEN_SHIPPING_CHF", prevShip],
      ["SCRAPER_VEN_SKIP_OVER_30KG", prevSkip],
      ["SCRAPER_VEN_BULKY_SHIPPING_CHF", prevBulky],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("quotes PostPac Economy by weight, not flat 10", () => {
    delete process.env.SCRAPER_VEN_MARGIN_PERCENT;
    delete process.env.SCRAPER_VEN_SHIPPING_CHF;
    expect(venovaPricingConfig().shippingChf).toBeNull();
    const cost = computeVenovaSellPrice(1944, 5);
    expect(cost?.shippingChf).toBe(12);
    expect(cost?.shippingReason).toBe("postpac_economy_le_10kg");
    expect(cost?.landedChf).toBe(1956);
    expect(cost?.sellPriceChf).toBe(2347.2);
    expect(cost?.skippedReason).toBeNull();
  });

  it("2kg band is CHF 9", () => {
    delete process.env.SCRAPER_VEN_SHIPPING_CHF;
    expect(resolveVenovaShippingChf(1.2).shippingChf).toBe(9);
  });

  it("unknown weight is not sellable — no invented ship", () => {
    delete process.env.SCRAPER_VEN_SHIPPING_CHF;
    const ship = resolveVenovaShippingChf(null);
    expect(ship.skip).toBe(true);
    expect(ship.reason).toBe("weight_unknown");
    const cost = computeVenovaSellPrice(100, null);
    expect(cost?.skippedReason).toBe("weight_unknown");
    expect(cost?.sellPriceChf).toBe(0);
  });

  it("over 30kg is Planzer — skip, do not charge CHF 10", () => {
    delete process.env.SCRAPER_VEN_BULKY_SHIPPING_CHF;
    delete process.env.SCRAPER_VEN_SHIPPING_CHF;
    const ship = resolveVenovaShippingChf(128);
    expect(ship.skip).toBe(true);
    expect(ship.reason).toBe("over_30kg_not_postpac");
  });

  it("env flat override still wins when set", () => {
    process.env.SCRAPER_VEN_SHIPPING_CHF = "10";
    expect(resolveVenovaShippingChf(5).shippingChf).toBe(10);
    expect(resolveVenovaShippingChf(5).reason).toBe("env_flat_override");
  });
});
