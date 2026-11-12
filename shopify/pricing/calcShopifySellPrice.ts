import {
  classifySuggestedSellCategory,
  getLegoInboundShippingChf,
  psychRoundUp,
  type SuggestedSellCategory,
} from "@/galaxus/pricing/suggestedSellPrice";
import { STX_CH_LIST_MULTIPLIER_BEFORE_SHIPPING } from "@/galaxus/stx/chfStockxBuyPrice";

export type CalcShopifySellPriceInput = {
  /** StockX list/ask before their fees (CHF). */
  stockxRaw: number;
  productCategory?: SuggestedSellCategory | string | null;
  productHandle?: string | null;
  productName?: string | null;
  brand?: string | null;
  isExpress?: boolean;
};

/**
 * Pricing rule label for audits / dry-runs.
 * `half` = locked CM2 floor formula (sneakers/clothing). LEGO keeps markup path.
 */
export type ShopifyPricingRule = "half" | "lego" | "manual_override";

/** @deprecated Removed from locked formula — kept for audit call-site compat. */
export const SHOPIFY_CPA_CAP_HALF = 24.0;

// ---------------------------------------------------------------------------
// LOCKED Shopify sell formula (v2026-11-09) — volume sweet-spot structure.
// Shape of 2026-09-19 (ads + CM2 as % of sell, no fixed ads/profit CHF),
// with real StockX CH checkout cost (raw × 1.1065 + 20).
//
// shopifySellPrice =
//   (sourceCostChf + fixedFulfillmentAndShippingChf)
//   / (1 - blendedPaymentCostRate - VATFlatRate - paidAdsRate - targetCM2Rate)
// then ceil to whole CHF.
// sourceCostChf = raw × 1.1065 + 20.
// Express uses the same locked calc (no flat +20 surcharge).
// ---------------------------------------------------------------------------
export const SHOPIFY_PRICING_LOCK_VERSION = "2026-11-09-sep19-real-stx";
/** Measured Sep 2026 per order: fulfilment 6.2 + postage 4.7 + apps 3.2 + fixed 0.4. */
export const SHOPIFY_FIXED_FULFILLMENT_AND_SHIPPING_CHF = 14.5;
/** Shopify payouts Jan–Sep 2026 = 97.1% of net sales (fees + refunds). */
export const SHOPIFY_BLENDED_PAYMENT_COST_RATE = 0.029;
/** Saldo VAT rate. */
export const SHOPIFY_VAT_FLAT_RATE = 0.021;
/**
 * @deprecated Not in this lock. Kept at 0 so old call sites that still subtract it
 * from the denom do not change the locked price.
 */
export const SHOPIFY_DISCOUNT_LEAKAGE_RATE = 0;
/**
 * @deprecated Ads are a share of sell again (SHOPIFY_PAID_ADS_RATE). Kept at 0.
 */
export const SHOPIFY_ADS_PER_ORDER_CHF = 0;
/** Ads share of sell — matches high-volume week CPA (~15% of ~180 CHF ≈ 27 CHF). */
export const SHOPIFY_PAID_ADS_RATE = 0.15;
/**
 * @deprecated Fixed profit CHF removed; CM2 is SHOPIFY_TARGET_CM2_RATE only.
 */
export const SHOPIFY_TARGET_PROFIT_PER_ORDER_CHF = 0;
/** Target contribution after reserved fees/ads (12% of sell). */
export const SHOPIFY_TARGET_CM2_RATE = 0.12;

/** Exact floor before storefront publish (centime). */
export function ceilToCentime(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.ceil(value * 100 - 1e-12) / 100;
}

/**
 * Shopify publish round: ceil to whole CHF — competitive clean ticket, ≤1 CHF
 * above locked floor. Never round down under the floor.
 */
export function ceilToWholeFranc(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.ceil(value - 1e-12);
}

export function shopifyLockedDenom(): number {
  return (
    1 -
    SHOPIFY_BLENDED_PAYMENT_COST_RATE -
    SHOPIFY_VAT_FLAT_RATE -
    SHOPIFY_PAID_ADS_RATE -
    SHOPIFY_TARGET_CM2_RATE
  );
}

/** Real StockX CH checkout cost (list + processing + 20 shipping). */
export function stxSourceCostChfFromRaw(stockxRaw: number): number {
  return stockxRaw * STX_CH_LIST_MULTIPLIER_BEFORE_SHIPPING + 20.0;
}

/**
 * Locked storefront sell from source cost (StockX after-fees buy).
 * Formula → ceil whole CHF.
 */
export function calcShopifySellFromSourceCost(sourceCostChf: number): number | null {
  const C = Number(sourceCostChf);
  if (!Number.isFinite(C) || C <= 0) return null;
  const denom = shopifyLockedDenom();
  if (!(denom > 0)) return null;
  return ceilToWholeFranc((C + SHOPIFY_FIXED_FULFILLMENT_AND_SHIPPING_CHF) / denom);
}

/**
 * Locked Shopify sell from StockX raw ask.
 * sourceCost = raw×1.1065+20 (sneakers) or raw×1.10+legoShip (LEGO markup path separate).
 * isExpress does not change the locked base.
 */
export function calcShopifySellPrice(input: CalcShopifySellPriceInput): number | null {
  const stockxRaw = Number(input.stockxRaw);
  if (!Number.isFinite(stockxRaw) || stockxRaw <= 0) return null;

  const productHandle = String(input.productHandle ?? "");
  const productName = String(input.productName ?? "");
  const category =
    typeof input.productCategory === "string" &&
    (input.productCategory === "sneakers" ||
      input.productCategory === "clothing" ||
      input.productCategory === "lego")
      ? input.productCategory
      : classifySuggestedSellCategory({
          productHandle,
          productName,
        });

  const isLego = category === "lego";

  if (isLego) {
    const legoShipping = getLegoInboundShippingChf(productHandle);
    const C = stockxRaw * 1.1 + legoShipping;
    const finalPriceRaw = (C + SHOPIFY_FIXED_FULFILLMENT_AND_SHIPPING_CHF) * 1.33;
    return ceilToWholeFranc(finalPriceRaw);
  }

  return calcShopifySellFromSourceCost(stxSourceCostChfFromRaw(stockxRaw));
}

/** Which production rule `calcShopifySellPrice` would apply (never `full`). */
export function resolveShopifyPricingRule(
  input: Pick<
    CalcShopifySellPriceInput,
    "productCategory" | "productHandle" | "productName"
  >
): Exclude<ShopifyPricingRule, "manual_override"> {
  const productHandle = String(input.productHandle ?? "");
  const productName = String(input.productName ?? "");
  const category =
    typeof input.productCategory === "string" &&
    (input.productCategory === "sneakers" ||
      input.productCategory === "clothing" ||
      input.productCategory === "lego")
      ? input.productCategory
      : classifySuggestedSellCategory({ productHandle, productName });
  return category === "lego" ? "lego" : "half";
}

export type ShopifySellPriceBreakdown = {
  stockxRaw: number;
  costChf: number;
  costPlusShip: number;
  rule: Exclude<ShopifyPricingRule, "manual_override">;
  cpaCap: number | null;
  calculatedSell: number | null;
  isExpress: boolean;
  lockVersion: string;
};

/** Dry-run friendly breakdown for audits (no Shopify writes). */
export function explainShopifySellPrice(
  input: CalcShopifySellPriceInput
): ShopifySellPriceBreakdown {
  const stockxRaw = Number(input.stockxRaw);
  const isExpress = Boolean(input.isExpress);
  const rule = resolveShopifyPricingRule(input);
  const shipF = SHOPIFY_FIXED_FULFILLMENT_AND_SHIPPING_CHF;

  if (!Number.isFinite(stockxRaw) || stockxRaw <= 0) {
    return {
      stockxRaw,
      costChf: NaN,
      costPlusShip: NaN,
      rule,
      cpaCap: null,
      calculatedSell: null,
      isExpress,
      lockVersion: SHOPIFY_PRICING_LOCK_VERSION,
    };
  }

  const productHandle = String(input.productHandle ?? "");
  let costChf: number;
  if (rule === "lego") {
    costChf = stockxRaw * 1.1 + getLegoInboundShippingChf(productHandle);
  } else {
    costChf = stxSourceCostChfFromRaw(stockxRaw);
  }

  return {
    stockxRaw,
    costChf: Math.round(costChf * 100) / 100,
    costPlusShip: Math.round((costChf + shipF) * 100) / 100,
    rule,
    cpaCap: null,
    calculatedSell: calcShopifySellPrice(input),
    isExpress,
    lockVersion: SHOPIFY_PRICING_LOCK_VERSION,
  };
}

/**
 * @deprecated Express no longer adds a flat surcharge. Always returns 0.
 * Env vars ignored so old configs cannot reintroduce +20.
 */
export function readStxExpressSurchargeChf(): number {
  return 0;
}

/**
 * Express floor = standard sell (same locked calc). No flat +20.
 * When expressCalc is above standard, keep it.
 */
export function applyStxExpressFloor(
  standardSell: number,
  expressCalc: number | null
): number | null {
  if (!Number.isFinite(standardSell) || standardSell <= 0) return expressCalc;
  if (expressCalc == null) return ceilToWholeFranc(standardSell);
  if (expressCalc <= standardSell) return ceilToWholeFranc(standardSell);
  return ceilToWholeFranc(expressCalc);
}

export type StxWebsiteSellPrices = {
  normalSell: number | null;
  expressSell: number | null;
  /**
   * single_lane = one StockX offer (or identical buys):
   *   standard = express = locked(calc) — same price
   * dual_lane = distinct standard + express buys:
   *   standard = locked(standard); express = max(locked(express), standard)
   */
  mode: "single_lane" | "dual_lane" | "none";
};

/**
 * Website STX dual pricing:
 *
 * - Distinct standard + express StockX asks:
 *   standard = locked(standard buy); express = locked(express buy).
 *   Never undercut standard. No flat +20.
 * - Same ask / single lane:
 *   standard = express = locked(calc). Same price.
 */
export function resolveStxWebsiteSellPrices(input: {
  standardBuyPrice: number | null;
  expressBuyPrice: number | null;
  /** SupplierVariant.price fallback when lane columns empty. */
  fallbackBuyPrice?: number | null;
  deliveryType?: string | null;
  calcFromBuy: (buyPrice: number, isExpress: boolean) => number | null;
}): StxWebsiteSellPrices {
  const delivery = String(input.deliveryType ?? "");
  const standardBuy =
    input.standardBuyPrice ??
    (delivery === "standard" ? input.fallbackBuyPrice ?? null : null);
  const expressBuy =
    input.expressBuyPrice ??
    (delivery.startsWith("express_") ? input.fallbackBuyPrice ?? null : null);
  const soleBuy = standardBuy ?? expressBuy ?? input.fallbackBuyPrice ?? null;
  if (soleBuy == null || !(soleBuy > 0)) {
    return { normalSell: null, expressSell: null, mode: "none" };
  }

  const hasDistinctDual =
    standardBuy != null &&
    expressBuy != null &&
    standardBuy > 0 &&
    expressBuy > 0 &&
    Math.abs(standardBuy - expressBuy) >= 0.5;

  if (!hasDistinctDual) {
    const normalSell = input.calcFromBuy(soleBuy, false);
    if (normalSell == null) return { normalSell: null, expressSell: null, mode: "none" };
    return {
      normalSell,
      expressSell: normalSell,
      mode: "single_lane",
    };
  }

  const normalSell = input.calcFromBuy(standardBuy!, false);
  if (normalSell == null) return { normalSell: null, expressSell: null, mode: "none" };
  const expressCalc = input.calcFromBuy(expressBuy!, true);
  const expressSell = ceilToWholeFranc(Math.max(expressCalc ?? normalSell, normalSell));
  return {
    normalSell,
    expressSell,
    mode: "dual_lane",
  };
}

/** StockX acquisition cost — port of Python `calc_touch_price`. */
export function calcShopifyTouchPrice(input: {
  stockxRaw: number;
  productCategory?: SuggestedSellCategory | string | null;
  productHandle?: string | null;
}): number | null {
  const stockxRaw = Number(input.stockxRaw);
  if (!Number.isFinite(stockxRaw) || stockxRaw <= 0) return null;

  const productHandle = String(input.productHandle ?? "");
  const category =
    typeof input.productCategory === "string" &&
    (input.productCategory === "sneakers" ||
      input.productCategory === "clothing" ||
      input.productCategory === "lego")
      ? input.productCategory
      : classifySuggestedSellCategory({ productHandle });

  if (category === "lego") {
    const shipping = getLegoInboundShippingChf(productHandle);
    return Math.round((stockxRaw * 1.1 + shipping) * 100) / 100;
  }

  return Math.round(stxSourceCostChfFromRaw(stockxRaw) * 100) / 100;
}

function readLiquidationDiscountPct(): number {
  const raw = process.env.LIQUIDATION_DISCOUNT_PCT ?? process.env.SHOPIFY_LIQUIDATION_DISCOUNT_PCT ?? "30";
  const n = Number.parseFloat(String(raw));
  if (!Number.isFinite(n) || n <= 0 || n >= 100) return 30;
  return n;
}

/**
 * Old physical liquidation sell: cost × 0.70 (default 30% off).
 * Warehouse shelf no longer uses this. In-stock physical price is
 * `warehouseHalfBuyNowPrice` (Buy Now / 2). Convergence must not write this
 * over a `price_locked` variant that still has physical stock.
 */
export function calcPhysicalLiquidationSellPrice(costChf: number): number | null {
  if (!Number.isFinite(costChf) || costChf <= 0) return null;
  const pct = readLiquidationDiscountPct();
  return psychRoundUp(costChf * (1 - pct / 100));
}
