/** Alternate.ch CHF retail → Galaxus sell (flat package ship + % margin).
 *
 * CH ships DE warehouse: flat CHF 16 / package (no free-ship AOV floor).
 * MOQ 1 pricing always bakes full package fee — cheap SKUs stay uncompetitive, expensive ones amortize.
 */

export type AlternateLandedCost = {
  buyChf: number;
  shippingChf: number;
  shippingReason: string;
  landedChf: number;
  marginPercent: number;
  sellPriceChf: number;
  priceSource: "chf_shelf_plus_ship_plus_margin";
};

/** Official Alternate CH package flat (customs + transport). */
export const ALTERNATE_PACKAGE_SHIP_CHF = 16;

export function alternatePricingConfig() {
  return {
    marginPercent: Math.max(0, Number(process.env.SCRAPER_ALT_MARGIN_PERCENT || "20")),
    shippingChf: Math.max(
      0,
      Number(process.env.SCRAPER_ALT_SHIPPING_CHF || ALTERNATE_PACKAGE_SHIP_CHF)
    ),
  };
}

function roundChf(value: number): number {
  return Math.round(value * 100) / 100;
}

/** (shelf + package ship) × (1 + margin%) → SupplierVariant.price. */
export function computeAlternateLandedCost(buyChf: number): AlternateLandedCost | null {
  if (!Number.isFinite(buyChf) || buyChf <= 0) return null;
  const cfg = alternatePricingConfig();
  const buy = roundChf(buyChf);
  const shippingChf = cfg.shippingChf;
  const landedChf = roundChf(buy + shippingChf);
  const sellPriceChf = roundChf(landedChf * (1 + cfg.marginPercent / 100));
  if (!Number.isFinite(sellPriceChf) || sellPriceChf <= 0) return null;
  return {
    buyChf: buy,
    shippingChf,
    shippingReason: `package_flat_chf${shippingChf}`,
    landedChf,
    marginPercent: cfg.marginPercent,
    sellPriceChf,
    priceSource: "chf_shelf_plus_ship_plus_margin",
  };
}

export function isPlausibleAlternateSellPrice(cost: AlternateLandedCost): boolean {
  return Number.isFinite(cost.sellPriceChf) && cost.sellPriceChf > 0 && cost.sellPriceChf < 100_000;
}
