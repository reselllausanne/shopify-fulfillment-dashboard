/** Venova.ch CHF retail → Galaxus sell (ship + % margin). */

export type VenovaLandedCost = {
  buyChf: number;
  shippingChf: number;
  shippingReason: string;
  landedChf: number;
  marginPercent: number;
  sellPriceChf: number;
  priceSource: "chf_shelf_plus_ship_plus_margin";
  weightKg: number | null;
  skippedReason: string | null;
};

/** PostPac Economy — Venova default parcel rate (no free shipping). */
export const VENOVA_POSTPAC_ECONOMY_CHF = 10;
/** Skip / Planzer territory — FAQ: >30 kg goes Planzer (variable). */
export const VENOVA_POST_MAX_KG = 30;

export function venovaPricingConfig() {
  return {
    marginPercent: Math.max(0, Number(process.env.SCRAPER_VEN_MARGIN_PERCENT || "20")),
    /** PostPac Economy floor — applied to all SKUs (incl. heavy / unknown Planzer). */
    shippingChf: Math.max(
      0,
      Number(process.env.SCRAPER_VEN_SHIPPING_CHF || VENOVA_POSTPAC_ECONOMY_CHF)
    ),
    /** Optional flat for known bulky; unused when skip-over-30 is off (default). */
    bulkyShippingChf:
      process.env.SCRAPER_VEN_BULKY_SHIPPING_CHF === undefined ||
      process.env.SCRAPER_VEN_BULKY_SHIPPING_CHF === ""
        ? null
        : Math.max(0, Number(process.env.SCRAPER_VEN_BULKY_SHIPPING_CHF)),
    postMaxKg: Math.max(1, Number(process.env.SCRAPER_VEN_POST_MAX_KG || VENOVA_POST_MAX_KG)),
    /** Default off — list heavy SKUs with ship floor; ops handle Planzer later. */
    skipOverPostMax: String(process.env.SCRAPER_VEN_SKIP_OVER_30KG ?? "0") === "1",
  };
}

function roundChf(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolveVenovaShippingChf(weightKg: number | null): {
  shippingChf: number;
  reason: string;
  skip: boolean;
  skipReason: string | null;
} {
  const cfg = venovaPricingConfig();
  if (weightKg != null && weightKg > cfg.postMaxKg) {
    if (cfg.skipOverPostMax && cfg.bulkyShippingChf == null) {
      return {
        shippingChf: 0,
        reason: "planzer_unknown",
        skip: true,
        skipReason: `weight_kg>${cfg.postMaxKg}_planzer`,
      };
    }
    if (cfg.bulkyShippingChf != null) {
      return {
        shippingChf: cfg.bulkyShippingChf,
        reason: "bulky_env_flat",
        skip: false,
        skipReason: null,
      };
    }
    // Heavy but allowed: still charge PostPac floor (ops absorbs Planzer delta).
    return {
      shippingChf: cfg.shippingChf,
      reason: "postpac_economy_floor_heavy",
      skip: false,
      skipReason: null,
    };
  }
  return {
    shippingChf: cfg.shippingChf,
    reason: "postpac_economy",
    skip: false,
    skipReason: null,
  };
}

/** (shelf + ship) × (1 + margin%) → SupplierVariant.price. */
export function computeVenovaSellPrice(
  buyChf: number,
  weightKg: number | null = null
): VenovaLandedCost | null {
  if (!Number.isFinite(buyChf) || buyChf <= 0) return null;
  const cfg = venovaPricingConfig();
  const ship = resolveVenovaShippingChf(weightKg);
  if (ship.skip) {
    return {
      buyChf: roundChf(buyChf),
      shippingChf: 0,
      shippingReason: ship.reason,
      landedChf: roundChf(buyChf),
      marginPercent: cfg.marginPercent,
      sellPriceChf: 0,
      priceSource: "chf_shelf_plus_ship_plus_margin",
      weightKg,
      skippedReason: ship.skipReason,
    };
  }
  const landedChf = roundChf(buyChf + ship.shippingChf);
  const sellPriceChf = roundChf(landedChf * (1 + cfg.marginPercent / 100));
  if (!Number.isFinite(sellPriceChf) || sellPriceChf <= 0) return null;
  return {
    buyChf: roundChf(buyChf),
    shippingChf: ship.shippingChf,
    shippingReason: ship.reason,
    landedChf,
    marginPercent: cfg.marginPercent,
    sellPriceChf,
    priceSource: "chf_shelf_plus_ship_plus_margin",
    weightKg,
    skippedReason: null,
  };
}

export function isPlausibleVenovaSellPrice(sellPriceChf: number): boolean {
  return Number.isFinite(sellPriceChf) && sellPriceChf > 0 && sellPriceChf < 100_000;
}
