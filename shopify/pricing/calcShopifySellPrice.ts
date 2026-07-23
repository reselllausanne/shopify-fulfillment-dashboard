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
 * TypeScript port of Python `calc_sell_price` (shopifyAPI_GQL.py) — same hybrid
 * ads-cost model used on the Shopify storefront.
 */
export function calcShopifySellPrice(input: CalcShopifySellPriceInput): number | null {
  const stockxRaw = Number(input.stockxRaw);
  if (!Number.isFinite(stockxRaw) || stockxRaw <= 0) return null;

  const productHandle = String(input.productHandle ?? "");
  const productName = String(input.productName ?? "");
  const brand = String(input.brand ?? "");
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
  const ADS_PCT = 0.13;
  const CPA_CAP = 17.0;
  const CM2_TARGET = 0.19;
  const SHIP_F = isExpress ? 15.0 : 7.0;
  const EXPRESS_UPSELL_PCT = 0.05;
  const BRAND_MARGIN_DISCOUNT = 0.1;
  const SAUCONY_MARGIN_DISCOUNT = 0.08;
  const SNEAKER_MARGIN_DISCOUNT = 0.05;
  const CLOTHING_MARGIN_DISCOUNT = 0.02;
  const LOW_AOV_COST_THRESHOLD = 100.0;
  const LOW_AOV_MIN_MARGIN = 50.0;
  const LOW_AOV_FULFIL = isExpress ? 15.0 : 13.0;

  const handleLower = productHandle.toLowerCase();
  const brandLower = brand.toLowerCase();
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

  const isAdidas = brandLower.includes("adidas") || (handleLower.includes("adidas") && !brandLower);
  const isSaucony = brandLower.includes("saucony") || (handleLower.includes("saucony") && !brandLower);
  const isOnitsuka =
    brandLower.includes("onitsuka") || (handleLower.includes("onitsuka") && !brandLower);
  const isSneaker = category === "sneakers";

  if ((isAdidas || isOnitsuka) && isSneaker) {
    finalPriceRaw *= 1.0 - BRAND_MARGIN_DISCOUNT;
  } else if (isSaucony && isSneaker) {
    finalPriceRaw *= 1.0 - SAUCONY_MARGIN_DISCOUNT;
  } else {
    const discount = isSneaker ? SNEAKER_MARGIN_DISCOUNT : CLOTHING_MARGIN_DISCOUNT;
    finalPriceRaw *= 1.0 - discount;
  }

  if (C <= LOW_AOV_COST_THRESHOLD) {
    const lowAovFloor = C + LOW_AOV_MIN_MARGIN + LOW_AOV_FULFIL;
    if (finalPriceRaw < lowAovFloor) finalPriceRaw = lowAovFloor;
  }

  if (isExpress) finalPriceRaw *= 1 + EXPRESS_UPSELL_PCT;

  return psychRoundUp(finalPriceRaw);
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
