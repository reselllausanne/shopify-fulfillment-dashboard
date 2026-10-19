import { REEFAPI_BASE, REEFAPI_KEY } from "@/market-pricing/config";
import type { MarketOffer, OfferAvailability, SourceResult } from "@/market-pricing/types";
import {
  fetchJson,
  isSelfSeller,
  type LookupInput,
  type PriceSource,
  skipped,
} from "@/market-pricing/sources/source";

type ReefSearchRow = {
  id?: string;
  product_id?: string;
  title?: string;
  row_type?: string;
  lowest_price?: number;
  lowest_price_incl_shipping?: number;
  offers_count?: number;
  gtins?: string[];
};
type ReefSearchResponse = { results?: ReefSearchRow[] };

type ReefOffer = {
  shop?: string;
  shop_id?: string;
  title?: string;
  price?: number;
  shipping?: number;
  total_price?: number;
  availability?: string;
};
type ReefOffersResponse = { offers?: ReefOffer[] };

function mapAvailability(raw: string | undefined): OfferAvailability {
  const s = (raw ?? "").toLowerCase();
  if (!s) return "unknown";
  if (/(an lager|in stock|sofort|disponible|verfügbar|lieferbar)/.test(s)) return "in_stock";
  if (/(ausverkauft|out of stock|nicht|rupture|épuisé|unavailable)/.test(s)) return "out_of_stock";
  return "unknown";
}

async function reefPost<T>(action: string, body: Record<string, unknown>): Promise<T | null> {
  if (!REEFAPI_KEY) return null;
  return fetchJson<T>(`${REEFAPI_BASE}/toppreise/v1/${action}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REEFAPI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    timeoutMs: 20_000,
  });
}

/**
 * toppreise.ch (Switzerland's price comparison) via the ReefAPI bridge.
 * No documented GTIN param: keyword-search, pick the row whose GTIN matches,
 * then pull every shop offer with shipping + availability.
 */
export const toppreiseSource: PriceSource = {
  key: "toppreise",
  isEnabled: () => Boolean(REEFAPI_KEY),
  async lookup(input: LookupInput): Promise<SourceResult> {
    if (!REEFAPI_KEY) return skipped("toppreise");
    const search = await reefPost<ReefSearchResponse>("search", { query: input.queryTerm });
    const rows = (search?.results ?? []).filter((r) => r.row_type !== "series");
    if (rows.length === 0) {
      return { source: "toppreise", ok: true, offers: [], shopCount: 0 };
    }

    // Prefer a row whose GTIN matches; else the cheapest-offer-count catalogue row.
    const byGtin = rows.find((r) => (r.gtins ?? []).some((g) => g === input.gtin));
    const chosen = byGtin ?? rows[0];
    const productId = chosen.product_id ?? chosen.id;
    if (!productId) {
      return { source: "toppreise", ok: true, offers: [], shopCount: chosen.offers_count ?? null };
    }

    const offersResp = await reefPost<ReefOffersResponse>("offers", { product_id: productId });
    const observedAt = new Date().toISOString();
    const offers: MarketOffer[] = (offersResp?.offers ?? [])
      .map((o) => {
        const priceChf = typeof o.price === "number" ? o.price : null;
        const totalChf = typeof o.total_price === "number" ? o.total_price : null;
        return {
          source: "toppreise",
          seller: o.shop ?? null,
          priceChf,
          totalChf,
          availability: mapAvailability(o.availability),
          productUrl: null,
          isSelf: isSelfSeller(o.shop ?? null, input.selfSellerNames),
          observedAt,
        };
      })
      .filter((o) => o.priceChf != null && o.priceChf > 0);

    return {
      source: "toppreise",
      ok: true,
      offers,
      shopCount: chosen.offers_count ?? offers.length,
    };
  },
};
