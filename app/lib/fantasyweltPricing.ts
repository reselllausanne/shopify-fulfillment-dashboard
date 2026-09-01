/** FantasyWelt.de (DE/EUR) → CHF sell pricing for Galaxus SupplierVariant.price */

export type FantasyweltLandedCost = {
  buyEurGross: number;
  buyChf: number;
  shippingChf: number;
  shippingReason: string;
  landedChf: number;
  marginPercent: number;
  sellPriceChf: number;
  eurChfRate: number;
  deVatRate: number;
  priceSource: "eur_gross_converted";
};

export function fantasyweltPricingConfig() {
  const reiMargin = process.env.SCRAPER_REI_MARGIN_PERCENT;
  return {
    marginPercent: Math.max(
      0,
      Number(process.env.SCRAPER_FAN_MARGIN_PERCENT || reiMargin || "30")
    ),
    eurChfRate: Math.max(
      0.01,
      Number(process.env.SCRAPER_FAN_EUR_CHF_RATE || process.env.SCRAPER_REI_EUR_CHF_RATE || 0.96)
    ),
    /** Flat DE→CH parcel estimate when order below free-ship threshold. */
    shippingChf: Math.max(0, Number(process.env.SCRAPER_FAN_SHIPPING_CHF || 12)),
    freeShipEur: Math.max(0, Number(process.env.SCRAPER_FAN_FREE_SHIP_EUR || 75)),
    deVatRate: Math.max(0, Number(process.env.SCRAPER_FAN_DE_VAT_RATE || 0.19)),
  };
}

function roundChf(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolveFantasyweltShippingChf(buyEurGross: number): {
  shippingChf: number;
  reason: string;
} {
  const cfg = fantasyweltPricingConfig();
  const override = process.env.SCRAPER_FAN_SHIPPING_CHF;
  if (override !== undefined && override !== "" && Number(override) === 0) {
    return { shippingChf: 0, reason: "env_zero" };
  }
  if (buyEurGross >= cfg.freeShipEur) {
    return { shippingChf: 0, reason: "assumed_free_over_threshold" };
  }
  return { shippingChf: cfg.shippingChf, reason: "flat_de_ch" };
}

/** Landed buy CHF + % margin → Galaxus sell CHF (gross-ish shelf). */
export function computeFantasyweltLandedCost(buyEurGross: number): FantasyweltLandedCost | null {
  if (!Number.isFinite(buyEurGross) || buyEurGross <= 0) return null;
  const cfg = fantasyweltPricingConfig();
  const buyChf = roundChf(buyEurGross * cfg.eurChfRate);
  const { shippingChf, reason } = resolveFantasyweltShippingChf(buyEurGross);
  const landedChf = roundChf(buyChf + shippingChf);
  const sellPriceChf = roundChf(landedChf * (1 + cfg.marginPercent / 100));
  return {
    buyEurGross: roundChf(buyEurGross),
    buyChf,
    shippingChf,
    shippingReason: reason,
    landedChf,
    marginPercent: cfg.marginPercent,
    sellPriceChf,
    eurChfRate: cfg.eurChfRate,
    deVatRate: cfg.deVatRate,
    priceSource: "eur_gross_converted",
  };
}
