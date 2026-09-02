/** Warenkontor.ch CHF retail → Galaxus sell (flat CH ship + REI-aligned % margin). */

export type WarenkontorLandedCost = {
  buyChf: number;
  shippingChf: number;
  shippingReason: string;
  landedChf: number;
  marginPercent: number;
  sellPriceChf: number;
  priceSource: "chf_shelf_plus_ship_plus_margin";
};

/**
 * Cart shipping_rates.json (CH zips): single rate
 * "Versand mit Schweizerische Post oder DPD" = CHF 6.00.
 * Holds at high cart totals (no free-shipping threshold observed).
 */
export const WARENKONTOR_FLAT_SHIPPING_CHF = 6;

export function isWarenkontorShop(input: {
  key?: string;
  baseUrl?: string;
}): boolean {
  const key = String(input.key || "")
    .trim()
    .toLowerCase();
  if (key === "wrk" || key === "war" || key === "warenkontor") return true;
  try {
    const host = new URL(String(input.baseUrl || "")).hostname.toLowerCase();
    return host === "warenkontor.ch" || host.endsWith(".warenkontor.ch");
  } catch {
    return false;
  }
}

export function warenkontorPricingConfig() {
  // Same margin knob as Reichelt unless WRK override set.
  const reiMargin = process.env.SCRAPER_REI_MARGIN_PERCENT;
  const marginRaw = process.env.SCRAPER_WRK_MARGIN_PERCENT || reiMargin || "30";
  return {
    marginPercent: Math.max(0, Number(marginRaw)),
    shippingChf: Math.max(
      0,
      Number(process.env.SCRAPER_WRK_SHIPPING_CHF || WARENKONTOR_FLAT_SHIPPING_CHF)
    ),
  };
}

function roundChf(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Landed = buy + flat CH ship; sell = landed × (1 + margin%). Margin mirrors REI default 30%. */
export function computeWarenkontorLandedCost(buyChf: number): WarenkontorLandedCost | null {
  if (!Number.isFinite(buyChf) || buyChf <= 0) return null;
  const cfg = warenkontorPricingConfig();
  const buy = roundChf(buyChf);
  const shippingChf = cfg.shippingChf;
  const landedChf = roundChf(buy + shippingChf);
  const sellPriceChf = roundChf(landedChf * (1 + cfg.marginPercent / 100));
  if (!Number.isFinite(sellPriceChf) || sellPriceChf <= 0) return null;
  return {
    buyChf: buy,
    shippingChf,
    shippingReason: shippingChf === WARENKONTOR_FLAT_SHIPPING_CHF ? "flat_post_dpd_chf6" : "env_override",
    landedChf,
    marginPercent: cfg.marginPercent,
    sellPriceChf,
    priceSource: "chf_shelf_plus_ship_plus_margin",
  };
}

export function isPlausibleWarenkontorSellPrice(cost: WarenkontorLandedCost): boolean {
  return Number.isFinite(cost.sellPriceChf) && cost.sellPriceChf > 0 && cost.sellPriceChf < 100_000;
}

export function formatWarenkontorNote(input: {
  handle?: string | null;
  sku?: string | null;
  cost: WarenkontorLandedCost;
}): string {
  return JSON.stringify({
    type: "warenkontor_landed_cost",
    handle: input.handle || undefined,
    sku: input.sku || undefined,
    buyChf: input.cost.buyChf,
    shippingChf: input.cost.shippingChf,
    shippingReason: input.cost.shippingReason,
    landedChf: input.cost.landedChf,
    marginPercent: input.cost.marginPercent,
    sellPriceChf: input.cost.sellPriceChf,
    priceSource: input.cost.priceSource,
  });
}
