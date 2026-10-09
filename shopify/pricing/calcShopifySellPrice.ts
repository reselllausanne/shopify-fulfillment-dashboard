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
// LOCKED Shopify sell formula (v2026-10-08) — manual constants only.
// Do not silently update from Shopify plan data or payment-method mix.
// shopifySellPrice =
//   (sourceCostChf + fixedFulfillmentAndShippingChf + adsPerOrderChf)
//   / (1 - blendedPaymentCostRate - VATFlatRate - targetCM2Rate)
// then ceil to whole CHF (WeTheNew-style clean francs; never below floor).
// sourceCostChf = real StockX checkout cost: raw × 1.1065 + 20.
// No …9/…5 psych bump.
// ---------------------------------------------------------------------------
export const SHOPIFY_PRICING_LOCK_VERSION = "2026-10-08-ads-per-order";
/** Measured Sep 2026 per order: fulfilment 6.2 + postage 4.7 + apps 3.2 + fixed 0.4. */
export const SHOPIFY_FIXED_FULFILLMENT_AND_SHIPPING_CHF = 14.5;
/** Shopify payouts Jan–Sep 2026 = 97.1% of net sales (fees + refunds). No +0.30. */
export const SHOPIFY_BLENDED_PAYMENT_COST_RATE = 0.029;
/** Saldo VAT rate. */
export const SHOPIFY_VAT_FLAT_RATE = 0.021;
/**
 * Ads are a per-order cost, not a share of price: 84% of 90-day spend goes to
 * offers that never convert, and a 100 CHF pair needs the same ad spend as a
 * 300 CHF pair. Real cost was 35/order (90 days) and 43.5 in Sep 2026; 30 is
 * the target once non-converting spend is cut.
 */
export const SHOPIFY_ADS_PER_ORDER_CHF = 30;
/** @deprecated Ads moved to SHOPIFY_ADS_PER_ORDER_CHF; kept at 0 for audit call sites. */
export const SHOPIFY_PAID_ADS_RATE = 0;
export const SHOPIFY_TARGET_CM2_RATE = 0.05;

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
  return ceilToWholeFranc(
    (C + SHOPIFY_FIXED_FULFILLMENT_AND_SHIPPING_CHF + SHOPIFY_ADS_PER_ORDER_CHF) / denom
  );
}

/**
 * Locked Shopify sell from StockX raw ask.
 * sourceCost = raw×1.1065+20 (sneakers) or raw×1.10+legoShip (LEGO markup path separate).
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
 * Flat CHF surcharge added on top of the standard sell price to guarantee a
 * meaningful express premium on STX dropship variants. Mirrors the warehouse
 * liquidation rule (LIQUIDATION_EXPRESS_SURCHARGE_CHF, default 20).
 */
export function readStxExpressSurchargeChf(): number {
  const raw =
    process.env.STX_EXPRESS_SURCHARGE_CHF ??
    process.env.SHOPIFY_STX_EXPRESS_SURCHARGE_CHF ??
    "20";
  const n = Number.parseFloat(String(raw));
  if (!Number.isFinite(n) || n < 0) return 20;
  return n;
}

/**
 * Single-offer express premium: express_price = standard_sell + surcharge (ceil).
 * Dual-lane: do NOT use this — each lane uses locked calc independently.
 */
export function applyStxExpressFloor(
  standardSell: number,
  expressCalc: number | null
): number | null {
  if (!Number.isFinite(standardSell) || standardSell <= 0) return expressCalc;
  const floor = ceilToWholeFranc(standardSell + readStxExpressSurchargeChf());
  if (expressCalc == null) return floor;
  // Legacy dual-lane callers: prefer calc when above standard; else surcharge floor.
  // New dual_lane path skips this helper entirely.
  return expressCalc <= standardSell ? floor : Math.max(expressCalc, floor);
}

export type StxWebsiteSellPrices = {
  normalSell: number | null;
  expressSell: number | null;
  /**
   * single_plus20 = one StockX offer (or identical buys):
   *   standard = calc(that buy); express = standard + 20
   * dual_lane = distinct standard + express buys:
   *   standard = calc(standard buy); express = max(calc(express buy), standard) + 20
   */
  mode: "single_plus20" | "dual_lane" | "none";
};

/**
 * Website STX dual pricing.
 *
 * - Only one offer (standard XOR express, or both buys equal):
 *   standard = locked(calc); express = standard + 20 (ceil).
 *   (Express-only: standard still = calc(express buy); express metafield = +20.)
 * - Distinct standard + express StockX asks:
 *   standard = locked(standard buy); express = max(locked(express buy), standard) + 20,
 *   so the express premium is earned on every lane and express never undercuts standard.
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
      expressSell: ceilToWholeFranc(normalSell + readStxExpressSurchargeChf()),
      mode: "single_plus20",
    };
  }

  const normalSell = input.calcFromBuy(standardBuy!, false);
  if (normalSell == null) return { normalSell: null, expressSell: null, mode: "none" };
  const expressCalc = input.calcFromBuy(expressBuy!, true);
  const expressBase = Math.max(expressCalc ?? normalSell, normalSell);
  return {
    normalSell,
    expressSell: ceilToWholeFranc(expressBase + readStxExpressSurchargeChf()),
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

  return Math.round((stockxRaw * 1.08 + 20) * 100) / 100;
}

function readLiquidationDiscountPct(): number {
  const raw = process.env.LIQUIDATION_DISCOUNT_PCT ?? process.env.SHOPIFY_LIQUIDATION_DISCOUNT_PCT ?? "30";
  const n = Number.parseFloat(String(raw));
  if (!Number.isFinite(n) || n <= 0 || n >= 100) return 30;
  return n;
}

/**
 * Physical liquidation sell on Shopify: **cost minus 30%** (default).
 * compareAt = calcShopifySellPrice(stockx raw) is applied separately.
 */
export function calcPhysicalLiquidationSellPrice(costChf: number): number | null {
  if (!Number.isFinite(costChf) || costChf <= 0) return null;
  const pct = readLiquidationDiscountPct();
  return psychRoundUp(costChf * (1 - pct / 100));
}
