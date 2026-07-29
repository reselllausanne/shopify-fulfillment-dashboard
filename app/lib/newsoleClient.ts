const DEFAULT_UA =
  process.env.SCRAPER_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type NewsoleWooCategory = { id: number; name: string; slug: string; link?: string };
export type NewsoleWooBrand = { id: number; name: string; slug: string; link?: string };
export type NewsoleWooVariationRef = { id: number; attributes: Array<{ name: string; value: string }> };
export type NewsoleWooPrices = {
  price: string;
  regular_price: string;
  sale_price: string;
  currency_code?: string;
  currency_minor_unit?: number;
};

export type NewsoleWooProduct = {
  id: number;
  name: string;
  slug: string;
  parent: number;
  type: string;
  variation: string;
  permalink: string;
  sku: string;
  description: string;
  short_description: string;
  on_sale: boolean;
  prices: NewsoleWooPrices;
  images: Array<{ id: number; src: string; thumbnail?: string; name?: string; alt?: string }>;
  categories: NewsoleWooCategory[];
  brands: NewsoleWooBrand[];
  attributes: Array<{ name: string; terms?: Array<{ name: string; slug: string }> }>;
  variations: NewsoleWooVariationRef[];
  has_options: boolean;
  is_in_stock: boolean;
  is_purchasable: boolean;
  stock_availability?: { text?: string; class?: string };
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function newsoleConfig() {
  return {
    userAgent: DEFAULT_UA,
    pageSize: Math.min(100, Math.max(1, Number(process.env.SCRAPER_NSO_PAGE_SIZE || 100))),
    requestDelayMs: Math.max(0, Number(process.env.SCRAPER_NSO_REQUEST_DELAY_MS ?? 80)),
    requestTimeoutMs: Math.max(5_000, Number(process.env.SCRAPER_NSO_REQUEST_TIMEOUT_MS || 45_000)),
    maxRetries: Math.max(1, Number(process.env.SCRAPER_NSO_MAX_RETRIES || 5)),
    variationConcurrency: Math.max(1, Number(process.env.SCRAPER_NSO_VARIATION_CONCURRENCY || 12)),
  };
}

export function parseNewsoleChfPrice(prices: NewsoleWooPrices | null | undefined): number | null {
  const raw = String(prices?.price ?? prices?.sale_price ?? prices?.regular_price ?? "").trim();
  if (!raw) return null;
  const minor = Number.parseInt(raw, 10);
  if (!Number.isFinite(minor) || minor <= 0) return null;
  const unit = prices?.currency_minor_unit ?? 2;
  return Math.round((minor / 10 ** unit) * 100) / 100;
}

export function extractNewsoleSizeLabel(product: NewsoleWooProduct): string | null {
  const fromVariation = String(product.variation ?? "").replace(/^[^:]+:\s*/i, "").trim();
  if (fromVariation) return fromVariation;
  for (const attr of product.attributes ?? []) {
    if (/size|gr[oö][sß]se|pointure/i.test(attr.name ?? "")) {
      const term = attr.terms?.[0]?.name;
      if (term) return term;
    }
  }
  return null;
}

export function inferNewsoleGender(name: string, categories: string[]): string | null {
  const hay = `${name} ${categories.join(" ")}`.toLowerCase();
  if (/(women'?s|womens|\(w\)|\bw\b|damen|femme)/i.test(hay)) return "women";
  if (/(grade school|\bgs\b|\by\b|kids|youth|enfant)/i.test(hay)) return "youth";
  if (/(men'?s|mens|\(m\)|herren|homme)/i.test(hay)) return "men";
  return "men";
}

export function isRetryableNewsoleError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? "").toLowerCase();
  return (
    msg.includes("http 429") ||
    msg.includes("http 502") ||
    msg.includes("http 503") ||
    msg.includes("http 504") ||
    msg.includes("timeout") ||
    msg.includes("fetch failed")
  );
}

export class NewsoleClient {
  constructor(private readonly baseUrl: string) {}

  private apiUrl(path: string, params?: Record<string, string | number>): string {
    const u = new URL(`${this.baseUrl.replace(/\/+$/, "")}/wp-json/wc/store/v1/${path.replace(/^\/+/, "")}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    }
    return u.href;
  }

  async fetchJson<T>(url: string): Promise<T> {
    const cfg = newsoleConfig();
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < cfg.maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": cfg.userAgent,
            Accept: "application/json",
            "Accept-Language": "fr-CH,fr;q=0.9,de;q=0.8,en;q=0.7",
          },
          signal: AbortSignal.timeout(cfg.requestTimeoutMs),
        });
        if (!res.ok) throw new Error(`Newsole HTTP ${res.status} ${url}`);
        const data = (await res.json()) as T;
        if (cfg.requestDelayMs) await sleep(cfg.requestDelayMs);
        return data;
      } catch (err) {
        lastErr = err;
        if (!isRetryableNewsoleError(err) || attempt >= cfg.maxRetries - 1) break;
        await sleep(cfg.requestDelayMs * Math.pow(2, attempt + 1));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async *iterProducts(maxProducts?: number): AsyncGenerator<{ product: NewsoleWooProduct; total: number }> {
    const cfg = newsoleConfig();
    let page = 1;
    let total = 0;
    let yielded = 0;

    for (;;) {
      const url = this.apiUrl("products", { per_page: cfg.pageSize, page });
      const res = await fetch(url, {
        headers: {
          "User-Agent": cfg.userAgent,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(cfg.requestTimeoutMs),
      });
      if (!res.ok) throw new Error(`Newsole HTTP ${res.status} ${url}`);
      if (!total) total = Number(res.headers.get("x-wp-total") || 0);
      const batch = (await res.json()) as NewsoleWooProduct[];
      if (cfg.requestDelayMs) await sleep(cfg.requestDelayMs);
      if (!batch.length) break;

      for (const product of batch) {
        if (product.type !== "variable" && product.type !== "simple") continue;
        yielded++;
        yield { product, total };
        if (maxProducts && yielded >= maxProducts) return;
      }

      const totalPages = Number(res.headers.get("x-wp-totalpages") || 0);
      if (page >= totalPages) break;
      page++;
    }
  }

  fetchProductById(id: number): Promise<NewsoleWooProduct> {
    return this.fetchJson<NewsoleWooProduct>(this.apiUrl(`products/${id}`));
  }
}
