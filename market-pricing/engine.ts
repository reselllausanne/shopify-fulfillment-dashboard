import { calcGalaxusStxSellFromSourceCost } from "@/galaxus/exports/pricing";
import type { MarketSnapshot, SalesCategory, SourceResult } from "@/market-pricing/types";
import { aggregateMarket } from "@/market-pricing/aggregate";
import { buildDemandSignal } from "@/market-pricing/demand";
import { decideVerdict, floorInclFromExVatSell } from "@/market-pricing/verdict";
import type { LookupInput, PriceSource } from "@/market-pricing/sources/source";
import { dbReferenceSource } from "@/market-pricing/sources/dbReference";
import { ponitoSource } from "@/market-pricing/sources/ponito";
import { googleShoppingSource } from "@/market-pricing/sources/googleShopping";
import { toppreiseSource } from "@/market-pricing/sources/toppreise";

/** Everything the engine needs about one product we sell. */
export type ProductInput = {
  gtin: string;
  title: string | null;
  brand: string | null;
  category?: SalesCategory;
  /** Supplier cost ex VAT (CHF) — SupplierVariant.price for the STX/supplier row. */
  supplierCostExVatChf: number | null;
  /** Our current pushed consumer price incl. VAT (CHF). */
  ourPriceInclChf: number | null;
  /** Units sold in the last 30 days (velocity), when available. */
  ourUnits30d?: number | null;
  providerKey?: string | null;
};

const SELF_SELLER_NAMES = ["resell lausanne", "resell-lausanne", "resell"];

const SNEAKER_RE = /\b(sneaker|jordan|dunk|air max|air force|yeezy|new balance|asics|samba|gazelle)\b/i;
const LEGO_RE = /\blego\b/i;
const ELECTRONICS_RE = /\b(hdmi|cable|kabel|ssd|gpu|rtx|router|ryzen|usb|monitor|charger|delock)\b/i;
const APPAREL_RE = /\b(hoodie|tee|t-shirt|jacket|pants|shorts|jersey|crewneck|backpack|sock)\b/i;

export function classifyCategory(input: { title?: string | null; brand?: string | null }): SalesCategory {
  const hay = `${input.title ?? ""} ${input.brand ?? ""}`;
  if (LEGO_RE.test(hay)) return "lego";
  if (SNEAKER_RE.test(hay)) return "sneakers";
  if (ELECTRONICS_RE.test(hay)) return "electronics";
  if (APPAREL_RE.test(hay)) return "apparel";
  return "other";
}

/** Strip a trailing "(42.5)" size and collapse spaces to a clean search term. */
export function buildQueryTerm(title: string | null, brand: string | null): string {
  const base = (title ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (base) return base;
  return (brand ?? "").trim();
}

export function allSources(): PriceSource[] {
  return [dbReferenceSource, ponitoSource, googleShoppingSource, toppreiseSource];
}

async function runSources(sources: PriceSource[], input: LookupInput): Promise<SourceResult[]> {
  // Independent network calls — run concurrently; each source is already
  // failure-safe (returns ok:false instead of throwing).
  return Promise.all(sources.map((s) => s.lookup(input)));
}

/** Run the full comparator for one product. Read-only: never writes channel prices. */
export async function analyzeProduct(product: ProductInput): Promise<MarketSnapshot> {
  const category = product.category ?? classifyCategory(product);
  const queryTerm = buildQueryTerm(product.title, product.brand);

  const lookupInput: LookupInput = {
    gtin: product.gtin,
    title: product.title,
    brand: product.brand,
    category,
    queryTerm,
    selfSellerNames: SELF_SELLER_NAMES,
  };

  const [results, demand] = await Promise.all([
    runSources(allSources(), lookupInput),
    buildDemandSignal(queryTerm, product.ourUnits30d ?? null),
  ]);

  const market = aggregateMarket(results);

  const floorExVat = calcGalaxusStxSellFromSourceCost(product.supplierCostExVatChf ?? NaN);
  const floorInclChf = floorInclFromExVatSell(floorExVat);

  const verdict = decideVerdict({
    market,
    ourPriceInclChf: product.ourPriceInclChf,
    floorInclChf,
    supplierCostExVatChf: product.supplierCostExVatChf,
  });

  return {
    gtin: product.gtin,
    providerKey: product.providerKey ?? null,
    title: product.title,
    category,
    supplierCostExVatChf: product.supplierCostExVatChf,
    rivalOfferCount: market.rivalOfferCount,
    rivalShopCount: market.rivalShopCount,
    minChf: market.minChf,
    medianChf: market.medianChf,
    maxChf: market.maxChf,
    soldOutRatio: market.soldOutRatio,
    cheapestSeller: market.cheapestSeller,
    sourcesOk: market.sourcesOk,
    sourcesFailed: market.sourcesFailed,
    demand,
    verdict,
    offers: market.rivalOffers,
    observedAt: new Date().toISOString(),
  };
}

/** Analyze many products with a small concurrency cap to respect API rate limits. */
export async function analyzeProducts(
  products: ProductInput[],
  concurrency = 3
): Promise<MarketSnapshot[]> {
  const out: MarketSnapshot[] = [];
  let i = 0;
  async function worker() {
    while (i < products.length) {
      const idx = i++;
      out[idx] = await analyzeProduct(products[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, products.length) }, worker));
  return out;
}
