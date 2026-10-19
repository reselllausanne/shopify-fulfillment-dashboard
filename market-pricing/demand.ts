import { SERPAPI_KEY, TRENDS_PROVIDER } from "@/market-pricing/config";
import type { DemandSignal } from "@/market-pricing/types";
import { fetchJson } from "@/market-pricing/sources/source";

type SerpTrendsPoint = { values?: Array<{ extracted_value?: number }> };
type SerpTrendsResponse = {
  interest_over_time?: { timeline_data?: SerpTrendsPoint[] };
  error?: string;
};

/** Google Trends (Switzerland) interest for a term over the last 90 days. */
async function fetchTrends(term: string): Promise<{ index: number | null; direction: DemandSignal["trendsDirection"] }> {
  if (TRENDS_PROVIDER !== "serpapi" || !SERPAPI_KEY) return { index: null, direction: null };
  const url =
    `https://serpapi.com/search.json?engine=google_trends` +
    `&q=${encodeURIComponent(term)}&geo=CH&date=today%203-m&data_type=TIMESERIES` +
    `&api_key=${encodeURIComponent(SERPAPI_KEY)}`;
  const data = await fetchJson<SerpTrendsResponse>(url, { timeoutMs: 20_000 });
  const timeline = data?.interest_over_time?.timeline_data ?? [];
  const series = timeline
    .map((p) => p.values?.[0]?.extracted_value)
    .filter((v): v is number => typeof v === "number");
  if (series.length < 8) return { index: null, direction: null };

  const last = series.slice(-1)[0]!;
  const recent = avg(series.slice(-7));
  const prior = avg(series.slice(-14, -7));
  let direction: DemandSignal["trendsDirection"] = "flat";
  if (prior > 0) {
    const delta = (recent - prior) / prior;
    direction = delta > 0.1 ? "rising" : delta < -0.1 ? "falling" : "flat";
  }
  return { index: Math.round(last), direction };
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Blend Google Trends interest with our own 30-day sales velocity into a 0–100
 * demand score. Trends is the leading indicator; our velocity confirms it.
 */
export async function buildDemandSignal(
  queryTerm: string,
  ourUnits30d: number | null
): Promise<DemandSignal> {
  const { index, direction } = await fetchTrends(queryTerm);

  // Velocity component: 0 units → 0, ≥20 units/mo → 100 (log-ish cap).
  const velocityScore =
    ourUnits30d == null ? null : Math.min(100, Math.round((ourUnits30d / 20) * 100));

  let demandScore: number | null = null;
  if (index != null && velocityScore != null) {
    demandScore = Math.round(0.6 * index + 0.4 * velocityScore);
  } else if (index != null) {
    demandScore = index;
  } else if (velocityScore != null) {
    demandScore = velocityScore;
  }

  return {
    trendsIndex: index,
    trendsDirection: direction,
    ourUnits30d,
    demandScore,
  };
}
