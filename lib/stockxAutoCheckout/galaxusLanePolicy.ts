import type { StockxDesiredLane } from "@/lib/stockxAutoCheckout/types";

/**
 * Galaxus StockX buy lane HARD RULE:
 * 1. Default = EXPRESS (Galaxus sell price is calculated from Express).
 * 2. STANDARD only when Standard all-in is ≈50% (or less) of Express
 *    i.e. standardBuyChf ≤ expressBuyChf * threshold.
 *
 * Env: GALAXUS_BUY_STANDARD_MAX_RATIO_OF_EXPRESS (default 0.5).
 * Distinct from Shopify customer-express detection.
 */
export const GALAXUS_BUY_STANDARD_MAX_RATIO_OF_EXPRESS_DEFAULT = 0.5;

export function readGalaxusBuyStandardMaxRatioOfExpress(
  envValue: string | undefined = process.env.GALAXUS_BUY_STANDARD_MAX_RATIO_OF_EXPRESS
): number {
  if (envValue == null || envValue === "") {
    return GALAXUS_BUY_STANDARD_MAX_RATIO_OF_EXPRESS_DEFAULT;
  }
  const n = Number(envValue);
  if (!Number.isFinite(n) || n <= 0 || n > 1) {
    return GALAXUS_BUY_STANDARD_MAX_RATIO_OF_EXPRESS_DEFAULT;
  }
  return n;
}

function positiveChf(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Pure lane desire from buy prices (CHF all-in).
 * - both missing → null
 * - only express → EXPRESS
 * - only standard → STANDARD
 * - both → EXPRESS unless standard ≤ express * ratio
 */
export function chooseGalaxusDesiredLane(
  expressBuyChf: number | null | undefined,
  standardBuyChf: number | null | undefined,
  maxRatioOfExpress: number = readGalaxusBuyStandardMaxRatioOfExpress()
): StockxDesiredLane | null {
  const exp = positiveChf(expressBuyChf);
  const std = positiveChf(standardBuyChf);
  if (exp == null && std == null) return null;
  if (exp == null) return "STANDARD";
  if (std == null) return "EXPRESS";
  const ratio =
    Number.isFinite(maxRatioOfExpress) && maxRatioOfExpress > 0 && maxRatioOfExpress <= 1
      ? maxRatioOfExpress
      : GALAXUS_BUY_STANDARD_MAX_RATIO_OF_EXPRESS_DEFAULT;
  if (std <= exp * ratio) return "STANDARD";
  return "EXPRESS";
}
