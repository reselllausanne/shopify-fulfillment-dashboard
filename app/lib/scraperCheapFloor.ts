/**
 * Cheap SKU absolute margin floor (socks / creams / small toys).
 * When shelf/buy &lt; threshold, sell ≥ landed + minAbs (overrides weak % margin).
 */
export const SCRAPER_CHEAP_BUY_THRESHOLD_CHF = 10;
export const SCRAPER_CHEAP_MIN_ABS_MARGIN_CHF = 5;

export function applyCheapItemSellFloor(input: {
  buyChf: number;
  landedChf: number;
  sellFromPercentChf: number;
  thresholdChf?: number;
  minAbsMarginChf?: number;
}): { sellPriceChf: number; usedMinAbsFloor: boolean; minAbsMarginChf: number } {
  const buy = Number(input.buyChf);
  const landed = Number(input.landedChf);
  const fromPct = Number(input.sellFromPercentChf);
  const threshold = input.thresholdChf ?? SCRAPER_CHEAP_BUY_THRESHOLD_CHF;
  const minAbs = input.minAbsMarginChf ?? SCRAPER_CHEAP_MIN_ABS_MARGIN_CHF;

  if (
    !Number.isFinite(buy) ||
    !Number.isFinite(landed) ||
    !Number.isFinite(fromPct) ||
    buy <= 0 ||
    landed <= 0 ||
    fromPct <= 0
  ) {
    return {
      sellPriceChf: fromPct,
      usedMinAbsFloor: false,
      minAbsMarginChf: minAbs,
    };
  }

  if (!(buy < threshold) || !(minAbs > 0)) {
    return {
      sellPriceChf: Math.round(fromPct * 100) / 100,
      usedMinAbsFloor: false,
      minAbsMarginChf: minAbs,
    };
  }

  const floor = Math.round((landed + minAbs) * 100) / 100;
  const sell = Math.max(Math.round(fromPct * 100) / 100, floor);
  return {
    sellPriceChf: sell,
    usedMinAbsFloor: sell > fromPct + 1e-9,
    minAbsMarginChf: minAbs,
  };
}
