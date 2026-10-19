import { MARKET_COUNTRY, SERPAPI_KEY } from "@/market-pricing/config";
import type { MarketOffer, SourceResult } from "@/market-pricing/types";
import {
  fetchJson,
  isSelfSeller,
  type LookupInput,
  type PriceSource,
  skipped,
} from "@/market-pricing/sources/source";

type SerpShoppingResult = {
  title?: string;
  source?: string; // seller name
  link?: string;
  product_link?: string;
  extracted_price?: number;
  price?: string;
  second_hand_condition?: string;
};

type SerpResponse = {
  shopping_results?: SerpShoppingResult[];
  error?: string;
};

/** Parse "CHF 189.00" / "189.00 Fr." → number. */
function parseChf(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(/'/g, "").match(/([0-9]+(?:[.,][0-9]{1,2})?)/);
  if (!m) return null;
  const n = Number.parseFloat(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const GL = MARKET_COUNTRY.toLowerCase();
const HL = "fr";

/**
 * Google Shopping (Switzerland) via SerpAPI. Searching the raw GTIN returns the
 * consumer offers Google indexes — frequently Galaxus, Amazon, Microspot,
 * Ochsner, etc. These are shopper prices incl. VAT, not our buy cost.
 */
export const googleShoppingSource: PriceSource = {
  key: "google_shopping",
  isEnabled: () => Boolean(SERPAPI_KEY),
  async lookup(input: LookupInput): Promise<SourceResult> {
    if (!SERPAPI_KEY) return skipped("google_shopping");
    // GTIN query is the most precise; fall back to title when GTIN returns nothing.
    const queries = [input.gtin, input.queryTerm].filter(Boolean);
    const observedAt = new Date().toISOString();

    for (const q of queries) {
      const url =
        `https://serpapi.com/search.json?engine=google_shopping` +
        `&q=${encodeURIComponent(q)}&gl=${GL}&hl=${HL}&currency=CHF` +
        `&api_key=${encodeURIComponent(SERPAPI_KEY)}`;
      const data = await fetchJson<SerpResponse>(url, { timeoutMs: 20_000 });
      const rows = data?.shopping_results ?? [];
      if (rows.length === 0) continue;

      const offers: MarketOffer[] = rows
        .filter((r) => !r.second_hand_condition) // new only
        .map((r) => {
          const priceChf = typeof r.extracted_price === "number" ? r.extracted_price : parseChf(r.price);
          const seller = r.source ?? null;
          return {
            source: "google_shopping",
            seller,
            priceChf,
            totalChf: null,
            availability: "unknown" as const,
            productUrl: r.product_link ?? r.link ?? null,
            isSelf: isSelfSeller(seller, input.selfSellerNames),
            observedAt,
          };
        })
        .filter((o) => o.priceChf != null && o.priceChf > 0);

      if (offers.length > 0) {
        return { source: "google_shopping", ok: true, offers, shopCount: offers.length };
      }
    }
    return { source: "google_shopping", ok: true, offers: [], shopCount: 0 };
  },
};
