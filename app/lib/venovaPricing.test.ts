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

  it("uses PostPac Economy 10 + 20% on landed", () => {
    delete process.env.SCRAPER_VEN_MARGIN_PERCENT;
    delete process.env.SCRAPER_VEN_SHIPPING_CHF;
    expect(venovaPricingConfig().shippingChf).toBe(10);
    const cost = computeVenovaSellPrice(1944, 5);
    expect(cost?.shippingChf).toBe(10);
    expect(cost?.landedChf).toBe(1954);
    expect(cost?.sellPriceChf).toBe(2344.8); // 1954 * 1.2
    expect(cost?.skippedReason).toBeNull();
  });

  it("keeps ship floor on heavy SKUs (no skip by default)", () => {
    delete process.env.SCRAPER_VEN_BULKY_SHIPPING_CHF;
    delete process.env.SCRAPER_VEN_SKIP_OVER_30KG;
    const ship = resolveVenovaShippingChf(128);
    expect(ship.skip).toBe(false);
    expect(ship.shippingChf).toBe(10);
    expect(ship.reason).toBe("postpac_economy_floor_heavy");
    const cost = computeVenovaSellPrice(1944, 128);
    expect(cost?.skippedReason).toBeNull();
    expect(cost?.shippingChf).toBe(10);
    expect(cost?.sellPriceChf).toBe(2344.8);
  });

  it("can still skip heavy when SCRAPER_VEN_SKIP_OVER_30KG=1", () => {
    delete process.env.SCRAPER_VEN_BULKY_SHIPPING_CHF;
    process.env.SCRAPER_VEN_SKIP_OVER_30KG = "1";
    const ship = resolveVenovaShippingChf(128);
    expect(ship.skip).toBe(true);
  });
});
