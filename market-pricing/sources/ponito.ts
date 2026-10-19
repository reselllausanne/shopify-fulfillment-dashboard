import { MARKET_COUNTRY, PONITO_BASE, PONITO_TOKEN } from "@/market-pricing/config";
import type { MarketOffer, SourceResult } from "@/market-pricing/types";
import { fetchJson, type LookupInput, type PriceSource, skipped } from "@/market-pricing/sources/source";

type PonitoBestOffer = {
  price: number | null; // minor units (rappen)
  currency: string;
  shops_count: number | null;
};

type PonitoProduct = {
  id: string;
  name: string | null;
  brand: string | null;
  gtins?: string[];
  url: string;
  best_offer: PonitoBestOffer | null;
};

/**
 * Ponito: GTIN → one canonical Swiss product with the current best CHF offer and
 * the number of shops carrying it. Prices come back as integer rappen.
 * This is the primary Swiss comparison source.
 */
export const ponitoSource: PriceSource = {
  key: "ponito",
  isEnabled: () => Boolean(PONITO_TOKEN),
  async lookup(input: LookupInput): Promise<SourceResult> {
    if (!PONITO_TOKEN) return skipped("ponito");
    const url = `${PONITO_BASE}/products/${encodeURIComponent(input.gtin)}?country=${MARKET_COUNTRY}`;
    const data = await fetchJson<PonitoProduct>(url, {
      headers: { Authorization: `Bearer ${PONITO_TOKEN}` },
    });
    if (!data) {
      return { source: "ponito", ok: false, offers: [], shopCount: null, error: "no_response" };
    }
    const best = data.best_offer;
    const observedAt = new Date().toISOString();
    const offers: MarketOffer[] = [];
    if (best && typeof best.price === "number" && best.price > 0) {
      offers.push({
        source: "ponito",
        seller: null, // Ponito best_offer does not name the shop on this tier
        priceChf: Math.round(best.price) / 100,
        totalChf: null,
        availability: "in_stock",
        productUrl: data.url ?? null,
        isSelf: false,
        observedAt,
      });
    }
    return {
      source: "ponito",
      ok: true,
      offers,
      shopCount: best?.shops_count ?? null,
    };
  },
};
