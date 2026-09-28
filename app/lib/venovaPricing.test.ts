import { describe, expect, it, afterEach } from "vitest";
import {
  computeVenovaSellPrice,
  resolveVenovaShippingChf,
  venovaPricingConfig,
} from "@/app/lib/venovaPricing";

describe("venova shipping + margin", () => {
  const prevMargin = process.env.SCRAPER_VEN_MARGIN_PERCENT;
  const prevShip = process.env.SCRAPER_VEN_SHIPPING_CHF;
  const prevBulky = process.env.SCRAPER_VEN_BULKY_SHIPPING_CHF;

  afterEach(() => {
    for (const [k, v] of [
      ["SCRAPER_VEN_MARGIN_PERCENT", prevMargin],
      ["SCRAPER_VEN_SHIPPING_CHF", prevShip],
      ["SCRAPER_VEN_BULKY_SHIPPING_CHF", prevBulky],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("uses page PostPac Economy quote when present", () => {
    delete process.env.SCRAPER_VEN_MARGIN_PERCENT;
    delete process.env.SCRAPER_VEN_SHIPPING_CHF;
    const cost = computeVenovaSellPrice(100, 5, {
      method: "PostPac Economy",
      shippingChf: 10,
      kind: "postpac_economy",
    });
    expect(cost?.shippingChf).toBe(10);
    expect(cost?.shippingReason).toContain("page_postpac_economy");
    expect(cost?.sellPriceChf).toBe(132); // 110 * 1.2
  });

  it("uses page Stückgut quote for mega items (e.g. CHF 109 washer)", () => {
    delete process.env.SCRAPER_VEN_SHIPPING_CHF;
    const ship = resolveVenovaShippingChf(104, {
      method: "Stückgut (Kurier)",
      shippingChf: 109,
      kind: "stueckgut",
    });
    expect(ship.skip).toBe(false);
    expect(ship.shippingChf).toBe(109);
    const cost = computeVenovaSellPrice(1499, 104, {
      method: "Stückgut (Kurier)",
      shippingChf: 109,
      kind: "stueckgut",
    });
    expect(cost?.shippingChf).toBe(109);
    expect(cost?.skippedReason).toBeNull();
  });

  it("skips free/zero Stückgut (unknown freight)", () => {
    delete process.env.SCRAPER_VEN_SHIPPING_CHF;
    const ship = resolveVenovaShippingChf(80, {
      method: "Stückgut (Kurier)",
      shippingChf: 0,
      kind: "stueckgut",
    });
    expect(ship.skip).toBe(true);
  });

  it("without page widget falls back to PostPac weight bands", () => {
    delete process.env.SCRAPER_VEN_SHIPPING_CHF;
    expect(venovaPricingConfig().shippingChf).toBeNull();
    expect(resolveVenovaShippingChf(5).shippingChf).toBe(12);
  });

  it("env flat override still wins when set", () => {
    process.env.SCRAPER_VEN_SHIPPING_CHF = "10";
    expect(resolveVenovaShippingChf(5).shippingChf).toBe(10);
    expect(resolveVenovaShippingChf(5).reason).toBe("env_flat_override");
  });
});
