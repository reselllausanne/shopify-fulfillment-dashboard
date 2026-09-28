import { quotePostPacEconomy } from "@/app/lib/swissPostEconomy";
import type { VenovaPageShipping } from "@/app/lib/venovaClient";

/** Venova.ch CHF retail → Galaxus sell (page ship quote + % margin). */

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

/** Venova PostPac Economy list price on small PDPs. */
export const VENOVA_POSTPAC_ECONOMY_CHF = 10;
/** Skip / Planzer territory — FAQ: >30 kg goes Planzer (variable). */
export const VENOVA_POST_MAX_KG = 30;

export function venovaPricingConfig() {
  return {
    marginPercent: Math.max(0, Number(process.env.SCRAPER_VEN_MARGIN_PERCENT || "20")),
    /**
     * Optional override. Unset → use PDP shipping widget, then weight fallback.
     */
    shippingChf:
      process.env.SCRAPER_VEN_SHIPPING_CHF === undefined ||
      process.env.SCRAPER_VEN_SHIPPING_CHF === ""
        ? null
        : Math.max(0, Number(process.env.SCRAPER_VEN_SHIPPING_CHF)),
    bulkyShippingChf:
      process.env.SCRAPER_VEN_BULKY_SHIPPING_CHF === undefined ||
      process.env.SCRAPER_VEN_BULKY_SHIPPING_CHF === ""
        ? null
        : Math.max(0, Number(process.env.SCRAPER_VEN_BULKY_SHIPPING_CHF)),
    postMaxKg: Math.max(1, Number(process.env.SCRAPER_VEN_POST_MAX_KG || VENOVA_POST_MAX_KG)),
    /** Skip freight with CHF 0 (often free promo / missing quote). */
    skipFreeFreight: String(process.env.SCRAPER_VEN_SKIP_FREE_FREIGHT ?? "1") !== "0",
  };
}

function roundChf(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolveVenovaShippingChf(
  weightKg: number | null,
  pageShip: VenovaPageShipping | null = null
): {
  shippingChf: number;
  reason: string;
  skip: boolean;
  skipReason: string | null;
} {
  const cfg = venovaPricingConfig();
  if (cfg.shippingChf != null) {
    return {
      shippingChf: cfg.shippingChf,
      reason: "env_flat_override",
      skip: false,
      skipReason: null,
    };
  }

  if (pageShip) {
    if (pageShip.kind === "stueckgut") {
      if (pageShip.shippingChf <= 0 && cfg.skipFreeFreight) {
        return {
          shippingChf: 0,
          reason: "stueckgut_zero_or_missing",
          skip: true,
          skipReason: "stueckgut_zero_or_missing",
        };
      }
      return {
        shippingChf: pageShip.shippingChf,
        reason: `page_${pageShip.kind}:${pageShip.method}`,
        skip: false,
        skipReason: null,
      };
    }
    return {
      shippingChf: pageShip.shippingChf,
      reason: `page_${pageShip.kind}:${pageShip.method}`,
      skip: false,
      skipReason: null,
    };
  }

  // No page widget: PostPac bands by weight for small parcels only.
  const quote = quotePostPacEconomy({ weightKg });
  if (!quote.shippable || quote.shippingChf == null) {
    if (weightKg != null && weightKg > cfg.postMaxKg && cfg.bulkyShippingChf != null) {
      return {
        shippingChf: cfg.bulkyShippingChf,
        reason: "bulky_env_flat",
        skip: false,
        skipReason: null,
      };
    }
    return {
      shippingChf: 0,
      reason: quote.reason,
      skip: true,
      skipReason: quote.reason,
    };
  }
  return {
    shippingChf: quote.shippingChf,
    reason: quote.reason,
    skip: false,
    skipReason: null,
  };
}

/** (shelf + ship) × (1 + margin%) → SupplierVariant.price. */
export function computeVenovaSellPrice(
  buyChf: number,
  weightKg: number | null = null,
  pageShip: VenovaPageShipping | null = null
): VenovaLandedCost | null {
  if (!Number.isFinite(buyChf) || buyChf <= 0) return null;
  const cfg = venovaPricingConfig();
  const ship = resolveVenovaShippingChf(weightKg, pageShip);
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
