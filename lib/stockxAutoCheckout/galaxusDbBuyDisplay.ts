import { MAX_LOSS_PCT } from "@/lib/stockxAutoCheckout/types";

export type GalaxusDbBuyPick = {
  chf: number;
  lane: "standard" | "express";
};

function pos(v: number | null | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * DB buy shown on the order page = the lane the night buyer would take
 * (`chooseLaneByGalaxusNoLoss`), judged on DB prices instead of live checkout cards:
 * 1. EXPRESS if margin >= 0
 * 2. else STANDARD if loss <= MAX_LOSS_PCT
 * 3. else EXPRESS if loss <= MAX_LOSS_PCT
 * 4. else cheapest lane (buyer would abort; shows the best case, not a 1-ask express outlier)
 * Without sell price: cheapest lane.
 */
export function pickGalaxusDbBuyForDisplay(
  sellChf: number | null | undefined,
  standardBuyChf: number | null | undefined,
  expressBuyChf: number | null | undefined,
  maxLossPct: number = MAX_LOSS_PCT
): GalaxusDbBuyPick | null {
  const std = pos(standardBuyChf);
  const exp = pos(expressBuyChf);
  if (std == null && exp == null) return null;
  if (exp == null) return { chf: std!, lane: "standard" };
  if (std == null) return { chf: exp, lane: "express" };
  const sell = pos(sellChf);
  const cheapest: GalaxusDbBuyPick =
    std <= exp ? { chf: std, lane: "standard" } : { chf: exp, lane: "express" };
  if (sell == null) return cheapest;
  const margin = (total: number) => (sell - total) / sell;
  if (margin(exp) >= 0) return { chf: exp, lane: "express" };
  if (margin(std) >= -maxLossPct) return { chf: std, lane: "standard" };
  if (margin(exp) >= -maxLossPct) return { chf: exp, lane: "express" };
  return cheapest;
}
