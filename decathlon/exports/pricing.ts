export const DECATHLON_COMMISSION_RATE = 0.17;
export const DECATHLON_VAT_RATE = 0.08;
/** Per-pair fulfilment / ops lump in CHF (not Mirakl fees). */
export const DECATHLON_FIXED_COST_CHF = 7;
export const DECATHLON_PRICE_ROUND_TO = 0.01;

const _DECATHLON_RETAINED_FOR_CALIBRATION =
  1 -
  DECATHLON_COMMISSION_RATE -
  DECATHLON_VAT_RATE / (1 + DECATHLON_VAT_RATE);

/**
 * Calibrated so a **130.16 CHF** buy lands at **~202 CHF** list TTC (slightly under typical ~203 competition),
 * with {@link DECATHLON_FIXED_COST_CHF} in the numerator. Same fraction applies to all pairs.
 * Override with `DECATHLON_MARGIN_ON_BUY` (e.g. `0.12` for 12% on cost).
 */
export const DEFAULT_DECATHLON_MARGIN_ON_BUY =
  (202 * _DECATHLON_RETAINED_FOR_CALIBRATION - DECATHLON_FIXED_COST_CHF - 130.16) / 130.16;

const MARGIN_ON_BUY_ENV_KEYS = ["DECATHLON_MARGIN_ON_BUY", "DECATHLON_TARGET_MARGIN_ON_BUY"];

export type DecathlonSalePriceInputs = {
  buyPrice: number;
  fixedCost?: number;
  commissionRate?: number;
  vatRate?: number;
  targetNetMargin: number;
};

export type DecathlonSalePriceOverrides = {
  fixedCost?: number;
  commissionRate?: number;
  vatRate?: number;
  targetNetMargin?: number;
  /** Fraction of buy (e.g. 0.12 = 12% on cost). */
  marginOnBuy?: number | null;
};

/**
 * Tiered target **net margin on list** (legacy). Use only when `DECATHLON_PRICING_MODE=tiered`.
 */
export function computeDecathlonTargetMargin(buyPrice: number): number | null {
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) return null;
  if (buyPrice < 100) return 0.18;
  if (buyPrice < 120) return 0.16;
  if (buyPrice < 150) return 0.14;
  if (buyPrice < 200) return 0.13;
  if (buyPrice < 300) return 0.12;
  if (buyPrice < 500) return 0.11;
  if (buyPrice < 700) return 0.11;
  if (buyPrice < 1000) return 0.11;
  return 0.1;
}

export function computeDecathlonRetainedRate({
  commissionRate = DECATHLON_COMMISSION_RATE,
  vatRate = DECATHLON_VAT_RATE,
}: {
  commissionRate?: number;
  vatRate?: number;
}): number {
  if (!Number.isFinite(commissionRate) || !Number.isFinite(vatRate)) return 0;
  return 1 - commissionRate - vatRate / (1 + vatRate);
}

export function computeDecathlonSalePriceTTC({
  buyPrice,
  fixedCost = DECATHLON_FIXED_COST_CHF,
  commissionRate = DECATHLON_COMMISSION_RATE,
  vatRate = DECATHLON_VAT_RATE,
  targetNetMargin,
}: DecathlonSalePriceInputs): number | null {
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) return null;
  if (!Number.isFinite(targetNetMargin)) return null;
  const retainedRate = computeDecathlonRetainedRate({ commissionRate, vatRate });
  const denominator = retainedRate - targetNetMargin;
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  const raw = (buyPrice + fixedCost) / denominator;
  return Number.isFinite(raw) ? raw : null;
}

function readDecathlonMarginOnBuyFraction(): number {
  for (const key of MARGIN_ON_BUY_ENV_KEYS) {
    const raw = process.env[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const parsed = Number.parseFloat(String(raw));
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) continue;
    return parsed > 1 ? parsed / 100 : parsed;
  }
  return DEFAULT_DECATHLON_MARGIN_ON_BUY;
}

function isTieredPricingMode(): boolean {
  return String(process.env.DECATHLON_PRICING_MODE ?? "")
    .trim()
    .toLowerCase() === "tiered";
}

/**
 * List TTC from buy using **margin on buy (cost)** + fixed fulfilment:
 * `list = (buy + fixed + buy × marginOnBuy) / retainedRate`
 * Wallet check (model): `list × R − buy − fixed ≈ buy × marginOnBuy`.
 */
export function computeDecathlonOfferListPriceFromMarginOnBuy(
  buyNow: number,
  overrides?: DecathlonSalePriceOverrides
): number | null {
  if (!Number.isFinite(buyNow) || buyNow <= 0) return null;
  const fixedCost = overrides?.fixedCost ?? DECATHLON_FIXED_COST_CHF;
  const marginOnBuy =
    overrides?.marginOnBuy !== null && overrides?.marginOnBuy !== undefined
      ? (() => {
          const v = overrides.marginOnBuy!;
          if (!Number.isFinite(v) || v < 0) return NaN;
          return v > 1 ? v / 100 : v;
        })()
      : readDecathlonMarginOnBuyFraction();
  if (!Number.isFinite(marginOnBuy) || marginOnBuy < 0 || marginOnBuy > 1) return null;

  const retainedRate = computeDecathlonRetainedRate({
    commissionRate: overrides?.commissionRate ?? DECATHLON_COMMISSION_RATE,
    vatRate: overrides?.vatRate ?? DECATHLON_VAT_RATE,
  });
  if (!Number.isFinite(retainedRate) || retainedRate <= 0) return null;

  const profitOnBuy = buyNow * marginOnBuy;
  const numerator = buyNow + fixedCost + profitOnBuy;
  const raw = numerator / retainedRate;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return roundToIncrement(raw, DECATHLON_PRICE_ROUND_TO);
}

function computeDecathlonOfferListPriceTiered(
  buyNow: number,
  overrides?: DecathlonSalePriceOverrides
): number | null {
  const targetNetMargin =
    overrides?.targetNetMargin ?? computeDecathlonTargetMargin(buyNow);
  if (targetNetMargin == null) return null;
  const raw = computeDecathlonSalePriceTTC({
    buyPrice: buyNow,
    fixedCost: overrides?.fixedCost ?? DECATHLON_FIXED_COST_CHF,
    commissionRate: overrides?.commissionRate ?? DECATHLON_COMMISSION_RATE,
    vatRate: overrides?.vatRate ?? DECATHLON_VAT_RATE,
    targetNetMargin,
  });
  if (raw == null || raw <= 0) return null;
  return roundToIncrement(raw, DECATHLON_PRICE_ROUND_TO);
}

/**
 * Mirakl offer list TTC from buy (`buyNow`).
 * Default: **margin on buy** + {@link DECATHLON_FIXED_COST_CHF} (7) + retained-rate gross-up.
 * Legacy tiered net-on-list: set env `DECATHLON_PRICING_MODE=tiered`.
 */
export function computeDecathlonOfferListPriceFromBuyNow(
  buyNow: number,
  overrides?: DecathlonSalePriceOverrides
): number | null {
  if (isTieredPricingMode()) {
    return computeDecathlonOfferListPriceTiered(buyNow, overrides);
  }
  return computeDecathlonOfferListPriceFromMarginOnBuy(buyNow, overrides);
}

/**
 * Raw list price without overrides (legacy signature).
 * Prefer `computeDecathlonOfferListPriceFromBuyNow` for exports.
 */
export function computeDecathlonPriceFromBuyNow(
  buyNow: number,
  overrides?: DecathlonSalePriceOverrides
): number | null {
  return computeDecathlonOfferListPriceFromBuyNow(buyNow, overrides);
}

export function resolveDecathlonBuyNow(input: {
  buyNowStockx: number | null;
  manualOverride: number | null;
  manualLock: boolean;
}): number | null {
  if (input.manualLock && input.manualOverride && input.manualOverride > 0) {
    return input.manualOverride;
  }
  if (input.buyNowStockx && input.buyNowStockx > 0) {
    return input.buyNowStockx;
  }
  return null;
}

const DECATHLON_NER_SUPPLIER_KEY = "ner";

/**
 * After {@link computeDecathlonOfferListPriceFromBuyNow}: multiply list TTC
 * by 1.25 for all partner lines, by 1.01 for own products (+1% to track price sensitivity).
 */
export function applyDecathlonPartnerListPriceMultipliers(
  baseListPriceTtc: number,
  supplierKey: string | null,
  partnerKeysLower: Set<string>
): number {
  if (!Number.isFinite(baseListPriceTtc) || baseListPriceTtc <= 0) return baseListPriceTtc;
  const k = supplierKey?.toLowerCase() ?? "";
  if (k === DECATHLON_NER_SUPPLIER_KEY || partnerKeysLower.has(k)) {
    return roundToIncrement(baseListPriceTtc * 1.25, DECATHLON_PRICE_ROUND_TO);
  }
  return roundToIncrement(baseListPriceTtc * 1.01, DECATHLON_PRICE_ROUND_TO);
}

function roundToIncrement(value: number, increment: number): number {
  if (!Number.isFinite(value)) return value;
  if (!Number.isFinite(increment) || increment <= 0) return value;
  const scale = 1 / increment;
  return Math.round(value * scale) / scale;
}

const MANUAL_LIST_SURCHARGE_ENV_KEYS = [
  "DECATHLON_MANUAL_LIST_SURCHARGE_CHF",
  "DECATHLON_MANUAL_PRICE_SURCHARGE_CHF",
];

function readDecathlonManualListSurchargeChf(): number {
  for (const key of MANUAL_LIST_SURCHARGE_ENV_KEYS) {
    const raw = process.env[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const parsed = Number.parseFloat(String(raw));
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 25;
}

/**
 * Decathlon Mirakl offer `price` when the variant uses a DB manual (locked) list price: that value is your
 * intended sell TTC; we add a flat CHF buffer (default 25) for marketplace take — no margin formula on top.
 */
export function decathlonOfferListPriceFromManualLockedPrice(manualListPriceTtc: number): number {
  const surcharge = readDecathlonManualListSurchargeChf();
  return roundToIncrement(manualListPriceTtc + surcharge, DECATHLON_PRICE_ROUND_TO);
}
