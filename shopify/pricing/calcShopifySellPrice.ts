import {
  classifySuggestedSellCategory,
  getLegoInboundShippingChf,
  psychRoundUp,
  type SuggestedSellCategory,
} from "@/galaxus/pricing/suggestedSellPrice";

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
 * HALF = CPA_CAP 24 (sole production rule since 2026-09).
 * FULL (CPA 31 / adidas lifestyle) is retired — kept only as a historical label.
 */
export type ShopifyPricingRule = "half" | "lego" | "manual_override";

export const SHOPIFY_CPA_CAP_HALF = 24.0;

/**
 * @deprecated FULL CPA bake removed. Always returns false — adidas Samba/Gazelle/
 * Spezial/Campus use HALF like every other STX product.
 */
export function isAdidasLifestyleFullCpa(_input: {
  productHandle?: string | null;
  productName?: string | null;
  brand?: string | null;
  productCategory?: string | null;
}): boolean {
  return false;
}

/**
 * TypeScript port of Python `calc_sell_price` (shopifyAPI_GQL.py) — same hybrid
 * ads-cost model used on the Shopify storefront.
 *
 * Active rule: HALF only (CPA_CAP=24). FULL (31) is never applied on new calcs.
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
  const isExpress = Boolean(input.isExpress);

  const PSP = 0.032;
  const VAT = 0.023;
  const ADS_PCT = 0.14; // blended MER≈7
  // HALF only — FULL (CPA 31) retired for all brands/families
  const CPA_CAP = SHOPIFY_CPA_CAP_HALF;
  const CM2_TARGET = 0.21;
  /** Outbound customer ship in hybrid base — STX dropship ≈ 14.5 CHF (was 7 warehouse). */
  const SHIP_F = isExpress ? 15.0 : 14.5;
  const EXPRESS_UPSELL_PCT = 0.05;
  const LOW_AOV_COST_THRESHOLD = 100.0;
  const LOW_AOV_MIN_MARGIN = 50.0;
  const LOW_AOV_FULFIL = isExpress ? 15.0 : 13.0;

  const isLego = category === "lego";

  let C: number;
  if (isLego) {
    const legoShipping = getLegoInboundShippingChf(productHandle);
    C = stockxRaw * 1.1 + legoShipping;
  } else {
    C = stockxRaw * 1.08 + 20.0;
  }

  const C_plus_ship = C + SHIP_F;

  if (isLego) {
    let finalPriceRaw = C_plus_ship * 1.33;
    if (isExpress) finalPriceRaw *= 1 + EXPRESS_UPSELL_PCT;
    return psychRoundUp(finalPriceRaw);
  }

  const kPct = 1.0 / (1.0 - (PSP + VAT + ADS_PCT + CM2_TARGET));
  const pricePct = C_plus_ship * kPct;

  let finalPriceRaw: number;
  if (pricePct <= 190.0) {
    finalPriceRaw = pricePct;
  } else {
    const denom = 1.0 - (PSP + VAT + CM2_TARGET);
    finalPriceRaw = (C_plus_ship + CPA_CAP) / denom;
  }

  if (C <= LOW_AOV_COST_THRESHOLD) {
    const lowAovFloor = C + LOW_AOV_MIN_MARGIN + LOW_AOV_FULFIL;
    if (finalPriceRaw < lowAovFloor) finalPriceRaw = lowAovFloor;
  }

  if (isExpress) finalPriceRaw *= 1 + EXPRESS_UPSELL_PCT;

  return psychRoundUp(finalPriceRaw);
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
};

/** Dry-run friendly breakdown for audits (no Shopify writes). */
export function explainShopifySellPrice(
  input: CalcShopifySellPriceInput
): ShopifySellPriceBreakdown {
  const stockxRaw = Number(input.stockxRaw);
  const isExpress = Boolean(input.isExpress);
  const rule = resolveShopifyPricingRule(input);
  const shipF = isExpress ? 15.0 : 14.5;

  if (!Number.isFinite(stockxRaw) || stockxRaw <= 0) {
    return {
      stockxRaw,
      costChf: NaN,
      costPlusShip: NaN,
      rule,
      cpaCap: rule === "half" ? SHOPIFY_CPA_CAP_HALF : null,
      calculatedSell: null,
      isExpress,
    };
  }

  const productHandle = String(input.productHandle ?? "");
  let costChf: number;
  if (rule === "lego") {
    costChf = stockxRaw * 1.1 + getLegoInboundShippingChf(productHandle);
  } else {
    costChf = stockxRaw * 1.08 + 20.0;
  }

  return {
    stockxRaw,
    costChf: Math.round(costChf * 100) / 100,
    costPlusShip: Math.round((costChf + shipF) * 100) / 100,
    rule,
    cpaCap: rule === "half" ? SHOPIFY_CPA_CAP_HALF : null,
    calculatedSell: calcShopifySellPrice(input),
    isExpress,
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

/** Express floor: preserve express-ask pricing, but never <= standard. */
export function applyStxExpressFloor(
  standardSell: number,
  expressCalc: number | null
): number | null {
  if (!Number.isFinite(standardSell) || standardSell <= 0) return expressCalc;
  const floor = psychRoundUp(standardSell + readStxExpressSurchargeChf());
  if (expressCalc == null) return floor;
  return expressCalc <= standardSell ? floor : Math.max(expressCalc, floor);
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
