import type { MarketOffer, SourceResult } from "@/market-pricing/types";

export type AggregatedMarket = {
  rivalOffers: MarketOffer[];
  rivalOfferCount: number;
  rivalShopCount: number | null;
  minChf: number | null;
  medianChf: number | null;
  maxChf: number | null;
  soldOutRatio: number | null;
  cheapestSeller: string | null;
  sourcesOk: string[];
  sourcesFailed: string[];
};

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Merge every source result into one market view. Rival = not our own listing
 * and not our internal supply feed. Dedupe by (source, seller, price) so one
 * shop listed twice does not inflate the count.
 */
export function aggregateMarket(results: SourceResult[]): AggregatedMarket {
  const sourcesOk: string[] = [];
  const sourcesFailed: string[] = [];
  const all: MarketOffer[] = [];

  for (const r of results) {
    if (r.ok) sourcesOk.push(r.source);
    else sourcesFailed.push(r.source);
    for (const o of r.offers) all.push(o);
  }

  const rivalRaw = all.filter((o) => !o.isSelf && o.priceChf != null && o.priceChf > 0);
  const seen = new Set<string>();
  const rivalOffers: MarketOffer[] = [];
  for (const o of rivalRaw) {
    const k = `${o.source}|${(o.seller ?? "").toLowerCase()}|${o.priceChf}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rivalOffers.push(o);
  }

  const prices = rivalOffers.map((o) => o.priceChf!) as number[];
  const minChf = prices.length ? Math.min(...prices) : null;
  const maxChf = prices.length ? Math.max(...prices) : null;
  const medianChf = median(prices);

  const known = rivalOffers.filter((o) => o.availability !== "unknown");
  const soldOut = known.filter((o) => o.availability === "out_of_stock");
  const soldOutRatio = known.length ? soldOut.length / known.length : null;

  const cheapest = rivalOffers.reduce<MarketOffer | null>((best, o) => {
    if (!best) return o;
    return o.priceChf! < best.priceChf! ? o : best;
  }, null);

  // Shop count: prefer the max any single source reported (Ponito/toppreise know
  // the true shop count even when they return one aggregate offer).
  const reportedShopCounts = results
    .map((r) => r.shopCount)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const rivalShopCount = reportedShopCounts.length
    ? Math.max(...reportedShopCounts, rivalOffers.length)
    : rivalOffers.length || null;

  return {
    rivalOffers,
    rivalOfferCount: rivalOffers.length,
    rivalShopCount,
    minChf,
    medianChf,
    maxChf,
    soldOutRatio,
    cheapestSeller: cheapest?.seller ?? null,
    sourcesOk,
    sourcesFailed,
  };
}
