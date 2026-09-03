import { afterEach, describe, expect, it } from "vitest";
import {
  WARENKONTOR_FLAT_SHIPPING_CHF,
  computeWarenkontorLandedCost,
  isWarenkontorShop,
  warenkontorPricingConfig,
} from "@/app/lib/warenkontorPricing";

describe("warenkontorPricing", () => {
  const prevWrkMargin = process.env.SCRAPER_WRK_MARGIN_PERCENT;
  const prevReiMargin = process.env.SCRAPER_REI_MARGIN_PERCENT;
  const prevShip = process.env.SCRAPER_WRK_SHIPPING_CHF;

  afterEach(() => {
    if (prevWrkMargin === undefined) delete process.env.SCRAPER_WRK_MARGIN_PERCENT;
    else process.env.SCRAPER_WRK_MARGIN_PERCENT = prevWrkMargin;
    if (prevReiMargin === undefined) delete process.env.SCRAPER_REI_MARGIN_PERCENT;
    else process.env.SCRAPER_REI_MARGIN_PERCENT = prevReiMargin;
    if (prevShip === undefined) delete process.env.SCRAPER_WRK_SHIPPING_CHF;
    else process.env.SCRAPER_WRK_SHIPPING_CHF = prevShip;
  });

  it("detects warenkontor shop by key/host", () => {
    expect(isWarenkontorShop({ key: "wrk" })).toBe(true);
    expect(isWarenkontorShop({ key: "war" })).toBe(true);
    expect(isWarenkontorShop({ baseUrl: "https://warenkontor.ch" })).toBe(true);
    expect(isWarenkontorShop({ key: "wel", baseUrl: "https://www.wellplayed.ch" })).toBe(false);
  });

  it("uses REI margin default (30) + flat CHF 6 ship", () => {
    delete process.env.SCRAPER_WRK_MARGIN_PERCENT;
    delete process.env.SCRAPER_REI_MARGIN_PERCENT;
    delete process.env.SCRAPER_WRK_SHIPPING_CHF;
    expect(warenkontorPricingConfig().marginPercent).toBe(30);
    expect(warenkontorPricingConfig().shippingChf).toBe(WARENKONTOR_FLAT_SHIPPING_CHF);

    const cost = computeWarenkontorLandedCost(40);
    expect(cost).not.toBeNull();
    expect(cost!.shippingChf).toBe(6);
    expect(cost!.landedChf).toBe(46);
    expect(cost!.marginPercent).toBe(30);
    expect(cost!.sellPriceChf).toBe(Math.round(46 * 1.3 * 100) / 100);
  });

  it("inherits SCRAPER_REI_MARGIN_PERCENT when WRK override absent", () => {
    delete process.env.SCRAPER_WRK_MARGIN_PERCENT;
    process.env.SCRAPER_REI_MARGIN_PERCENT = "25";
    expect(warenkontorPricingConfig().marginPercent).toBe(25);
    const cost = computeWarenkontorLandedCost(10);
    expect(cost!.sellPriceChf).toBe(Math.round(16 * 1.25 * 100) / 100);
  });

  it("allows WRK ship/margin overrides", () => {
    process.env.SCRAPER_WRK_MARGIN_PERCENT = "20";
    process.env.SCRAPER_WRK_SHIPPING_CHF = "7.5";
    const cost = computeWarenkontorLandedCost(12);
    expect(cost!.shippingChf).toBe(7.5);
    expect(cost!.landedChf).toBe(19.5);
    expect(cost!.marginPercent).toBe(20);
    expect(cost!.sellPriceChf).toBe(Math.round(19.5 * 1.2 * 100) / 100);
  });
});
