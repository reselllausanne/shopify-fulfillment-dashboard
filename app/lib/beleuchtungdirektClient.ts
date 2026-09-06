import { validateGtin } from "@/app/lib/normalize";
import { isSchemaOfferInStock } from "@/app/lib/scraperAvailability";

const DEFAULT_UA =
  process.env.SCRAPER_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type BldAlgoliaConfig = {
  applicationId: string;
  apiKey: string;
  indexName: string;
  sortingIndices: Array<{ name?: string | null }>;
};

type BldSearchResponse = {
  hits: BldRawHit[];
  page: number;
  nbPages: number;
};

type BldPriceNode = {
  CHF?: {
    default?: number | null;
  } | null;
} | null;

type BldRawHit = {
  objectID?: string | null;
  name?: string | null;
  url?: string | null;
  sku?: string | number | null;
  ean?: string | number | null;
  brand?: string | null;
  manufacturer?: string | null;
  in_stock?: number | boolean | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  categories_without_path?: string[] | null;
  category?: string | null;
  price?: BldPriceNode | null;
  price_with_tax?: BldPriceNode | null;
};

type BldGroupTarget = {
  objectId: string;
  productUrl: string;
  name: string;
  brand: string | null;
  categories: string[];
  productType: string | null;
};

export type BldProduct = {
  objectId: string;
  name: string;
  productUrl: string;
  supplierSku: string | null;
  gtin: string;
  brand: string | null;
  imageUrl: string | null;
  categories: string[];
  productType: string | null;
  inStock: boolean;
  priceChf: number | null;
};

export function bldConfig() {
  return {
    userAgent: DEFAULT_UA,
    requestTimeoutMs: Math.max(5000, Number(process.env.SCRAPER_BLD_REQUEST_TIMEOUT_MS || 45_000)),
    requestDelayMs: Math.max(0, Number(process.env.SCRAPER_BLD_REQUEST_DELAY_MS || 40)),
    maxRetries: Math.max(1, Number(process.env.SCRAPER_BLD_MAX_RETRIES || 3)),
    hitsPerPage: Math.max(10, Math.min(200, Number(process.env.SCRAPER_BLD_HITS_PER_PAGE || 120))),
    productConcurrency: Math.max(1, Number(process.env.SCRAPER_BLD_PRODUCT_CONCURRENCY || 8)),
    defaultStock: Math.max(
      1,
      Number(process.env.SCRAPER_BLD_DEFAULT_STOCK || process.env.SCRAPER_DEFAULT_STOCK || 1)
    ),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(max = 400) {
  return Math.floor(Math.random() * max);
}

function pickFirstString(values: Array<unknown>): string | null {
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return null;
}

function normalizeDigits(raw: unknown): string {
  return String(raw ?? "").replace(/[^\d]/g, "");
}

function parsePositiveMoney(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function isRetryableBldError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? "").toLowerCase();
  return (
    msg.includes("http 429") ||
    msg.includes("http 500") ||
    msg.includes("http 502") ||
    msg.includes("http 503") ||
    msg.includes("http 504") ||
    msg.includes("timeout") ||
    msg.includes("aborted") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed")
  );
}

export function extractBldAlgoliaConfig(html: string): BldAlgoliaConfig {
  const match = html.match(/window\.algoliaConfig\s*=\s*(\{[\s\S]*?\});/i);
  if (!match) throw new Error("BLD algoliaConfig not found");
  const parsed = JSON.parse(match[1]) as {
    applicationId?: string;
    apiKey?: string;
    indexName?: string;
    sortingIndices?: Array<{ name?: string | null }>;
  };
  const applicationId = String(parsed.applicationId ?? "").trim();
  const apiKey = String(parsed.apiKey ?? "").trim();
  const indexName = String(parsed.indexName ?? "").trim();
  if (!applicationId || !apiKey || !indexName) {
    throw new Error("BLD algoliaConfig missing required fields");
  }
  return {
    applicationId,
    apiKey,
    indexName,
    sortingIndices: Array.isArray(parsed.sortingIndices) ? parsed.sortingIndices : [],
  };
}

export function chooseBldIndexCandidates(cfg: BldAlgoliaConfig): string[] {
  const candidates = new Set<string>();
  candidates.add(cfg.indexName);
  candidates.add(`${cfg.indexName}_products`);
  for (const row of cfg.sortingIndices) {
    const name = String(row?.name ?? "").trim();
    if (!name) continue;
    candidates.add(name);
  }
  return [...candidates];
}

export function mapBldHitToProduct(hit: BldRawHit): BldProduct | null {
  const gtin = normalizeDigits(hit.ean);
  if (!validateGtin(gtin)) return null;
  const productUrl = pickFirstString([hit.url]);
  const objectId = pickFirstString([hit.objectID, hit.sku, gtin]);
  const name = pickFirstString([hit.name]);
  if (!productUrl || !objectId || !name) return null;

  const categories = (hit.categories_without_path ?? [])
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
  const productType = pickFirstString([hit.category, categories[categories.length - 1]]);
  const priceIncl = parsePositiveMoney(hit.price_with_tax?.CHF?.default);
  const priceExcl = parsePositiveMoney(hit.price?.CHF?.default);
  const priceChf = priceIncl ?? priceExcl;
  const inStock = hit.in_stock === true || hit.in_stock === 1 || String(hit.in_stock ?? "") === "1";

  return {
    objectId,
    name,
    productUrl,
    supplierSku: pickFirstString([hit.sku]),
    gtin,
    brand: pickFirstString([hit.brand, hit.manufacturer]),
    imageUrl: pickFirstString([hit.image_url, hit.thumbnail_url]),
    categories,
    productType,
    inStock,
    priceChf,
  };
}

function mapBldHitToGroupTarget(hit: BldRawHit): BldGroupTarget | null {
  const productUrl = pickFirstString([hit.url]);
  const objectId = pickFirstString([hit.objectID, hit.sku]);
  const name = pickFirstString([hit.name]);
  if (!productUrl || !objectId || !name) return null;
  const categories = (hit.categories_without_path ?? [])
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
  const productType = pickFirstString([hit.category, categories[categories.length - 1]]);
  return {
    objectId,
    productUrl,
    name,
    brand: pickFirstString([hit.brand, hit.manufacturer]),
    categories,
    productType,
  };
}

function normalizeUrlPath(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

function parseBldJsonLdBlocks(html: string): unknown[] {
  const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  const out: unknown[] = [];
  for (const block of blocks) {
    const raw = String(block[1] ?? "").trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      continue;
    }
  }
  return out;
}

function parseBldVariantsFromGroupHtml(html: string, target: BldGroupTarget, baseUrl: string): BldProduct[] {
  const docs = parseBldJsonLdBlocks(html);
  const productGroup = docs.find((d) => {
    const t = String((d as { "@type"?: unknown })?.["@type"] ?? "");
    return t.toLowerCase().includes("productgroup");
  }) as
    | {
        name?: string;
        url?: string;
        brand?: { name?: string } | string;
        hasVariant?: Array<{
          sku?: string | number;
          name?: string;
          image?: string;
          offers?: {
            price?: number | string;
            availability?: string;
            url?: string;
          };
        }>;
      }
    | undefined;
  if (!productGroup || !Array.isArray(productGroup.hasVariant)) return [];

  const seen = new Set<string>();
  const variants: BldProduct[] = [];
  const groupBrand =
    typeof productGroup.brand === "string"
      ? productGroup.brand
      : pickFirstString([productGroup.brand?.name, target.brand]);
  const groupName = pickFirstString([productGroup.name, target.name]) || target.name;
  const groupUrl = normalizeUrlPath(pickFirstString([productGroup.url, target.productUrl]) || target.productUrl, baseUrl);

  for (const v of productGroup.hasVariant) {
    const gtin = normalizeDigits(v.sku);
    if (!validateGtin(gtin) || seen.has(gtin)) continue;
    seen.add(gtin);

    const priceChf = parsePositiveMoney(v.offers?.price);
    const availability = String(v.offers?.availability ?? "");
    const inStock = isSchemaOfferInStock(availability);

    variants.push({
      objectId: `${target.objectId}_${gtin}`,
      name: pickFirstString([v.name, groupName]) || groupName,
      productUrl: normalizeUrlPath(pickFirstString([v.offers?.url, groupUrl]) || groupUrl, baseUrl),
      supplierSku: gtin,
      gtin,
      brand: groupBrand,
      imageUrl: pickFirstString([v.image]),
      categories: target.categories,
      productType: target.productType,
      inStock,
      priceChf,
    });
  }

  return variants;
}

export class BeleuchtungdirektClient {
  private readonly listingUrl: string;

  constructor(baseUrl: string) {
    const root = baseUrl.replace(/\/+$/, "");
    this.listingUrl = `${root}/de/led-lampen`;
  }

  private async fetchTextWithRetry(url: string, init: RequestInit = {}): Promise<string> {
    const cfg = bldConfig();
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < cfg.maxRetries; attempt++) {
      try {
        const headers = new Headers(init.headers);
        headers.set("User-Agent", cfg.userAgent);
        headers.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
        headers.set("Accept-Language", "de-CH,de;q=0.9,en;q=0.8");
        if (!headers.has("Content-Type") && init.body) {
          headers.set("Content-Type", "application/json");
        }

        const res = await fetch(url, {
          ...init,
          headers,
          signal: AbortSignal.timeout(cfg.requestTimeoutMs),
          redirect: "follow",
        });
        if (!res.ok) throw new Error(`BLD HTTP ${res.status} ${url}`);
        const text = await res.text();
        if (!text) throw new Error(`BLD empty response ${url}`);
        if (cfg.requestDelayMs) await sleep(cfg.requestDelayMs + jitterMs(250));
        return text;
      } catch (err) {
        lastErr = err;
        if (!isRetryableBldError(err) || attempt >= cfg.maxRetries - 1) break;
        await sleep(800 * Math.pow(2, attempt) + jitterMs(500));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private async queryAlgolia(
    applicationId: string,
    apiKey: string,
    indexName: string,
    page: number
  ): Promise<BldSearchResponse> {
    const cfg = bldConfig();
    const host = `https://${applicationId.toLowerCase()}-dsn.algolia.net`;
    const body = {
      params: `query=&hitsPerPage=${cfg.hitsPerPage}&page=${page}`,
    };
    const raw = await this.fetchTextWithRetry(`${host}/1/indexes/${encodeURIComponent(indexName)}/query`, {
      method: "POST",
      headers: {
        "x-algolia-application-id": applicationId,
        "x-algolia-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
    const parsed = JSON.parse(raw) as BldSearchResponse;
    if (!Array.isArray(parsed.hits)) throw new Error(`BLD invalid algolia payload for ${indexName}`);
    return parsed;
  }

  async resolveSearchIndex(): Promise<{ applicationId: string; apiKey: string; indexName: string }> {
    const html = await this.fetchTextWithRetry(this.listingUrl);
    const cfg = extractBldAlgoliaConfig(html);
    const candidates = chooseBldIndexCandidates(cfg);
    let lastErr: unknown = null;
    for (const indexName of candidates) {
      try {
        await this.queryAlgolia(cfg.applicationId, cfg.apiKey, indexName, 0);
        return { applicationId: cfg.applicationId, apiKey: cfg.apiKey, indexName };
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(
      `BLD no working algolia index (${candidates.join(", ")}): ${
        (lastErr as Error)?.message || String(lastErr)
      }`
    );
  }

  async *iterGroupTargets(maxGroups?: number): AsyncGenerator<BldGroupTarget> {
    const search = await this.resolveSearchIndex();
    const first = await this.queryAlgolia(search.applicationId, search.apiKey, search.indexName, 0);
    let yielded = 0;

    const scanHits = async function* (hits: BldRawHit[]) {
      for (const hit of hits) {
        const target = mapBldHitToGroupTarget(hit);
        if (!target) continue;
        yield target;
      }
    };

    for await (const t of scanHits(first.hits)) {
      if (maxGroups && yielded >= maxGroups) return;
      yielded++;
      yield t;
    }
    for (let page = 1; page < first.nbPages; page++) {
      if (maxGroups && yielded >= maxGroups) break;
      const next = await this.queryAlgolia(search.applicationId, search.apiKey, search.indexName, page);
      for await (const t of scanHits(next.hits)) {
        if (maxGroups && yielded >= maxGroups) return;
        yielded++;
        yield t;
      }
    }
  }

  async fetchGroupVariants(target: {
    objectId: string;
    productUrl: string;
    name: string;
    brand: string | null;
    categories: string[];
    productType: string | null;
  }): Promise<BldProduct[]> {
    const html = await this.fetchTextWithRetry(target.productUrl);
    return parseBldVariantsFromGroupHtml(html, target, this.listingUrl);
  }

  async *iterProducts(maxProducts?: number): AsyncGenerator<BldProduct> {
    let yielded = 0;
    for await (const target of this.iterGroupTargets(maxProducts)) {
      const variants = await this.fetchGroupVariants(target);
      for (const product of variants) {
        if (maxProducts && yielded >= maxProducts) return;
        yielded++;
        yield product;
      }
    }
  }
}
