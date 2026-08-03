import { isValidGtin } from "@/galaxus/exports/feedValidation";

const USER_AGENT =
  process.env.SCRAPER_USER_AGENT || "LivioShopifyScraper/1.0 (+catalog sync)";

export type BaechliVariant = {
  sku: string;
  sizeLabel: string | null;
  priceChf: number | null;
  inStock: boolean;
  gtin: string | null;
  gtinSource: string | null;
  imageUrl: string | null;
};

export type BaechliProduct = {
  productUrl: string;
  name: string;
  brand: string | null;
  productType: string | null;
  variants: BaechliVariant[];
};

export function baechliConfig() {
  return {
    userAgent: USER_AGENT,
    requestTimeoutMs: Number(process.env.SCRAPER_REQUEST_TIMEOUT_MS || 45_000),
    requestDelayMs: Math.max(
      0,
      Number(process.env.SCRAPER_BAE_REQUEST_DELAY_MS ?? process.env.SCRAPER_REQUEST_DELAY_MS ?? 0)
    ),
    productConcurrency: Math.max(1, Number(process.env.SCRAPER_BAE_CONCURRENCY || 20)),
    defaultStock: Math.max(1, Number(process.env.SCRAPER_DEFAULT_STOCK || 5)),
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m) => {
      const map: Record<string, string> = {
        nbsp: " ",
        auml: "ä",
        ouml: "ö",
        uuml: "ü",
        Auml: "Ä",
        Ouml: "Ö",
        Uuml: "Ü",
        szlig: "ß",
        apos: "'",
      };
      return map[m.slice(1, -1)] ?? m;
    });
}

/** Prefer EAN-13, then GTIN-14/generic, then UPC-A (gtin12). All require GS1 check digit. */
export function normalizeBaechliBarcode(input: {
  gtin13?: string | null;
  gtin14?: string | null;
  gtin?: string | null;
  gtin12?: string | null;
}): { gtin: string; source: string } | null {
  const candidates: Array<[string, string | null | undefined]> = [
    ["gtin13", input.gtin13],
    ["gtin14", input.gtin14],
    ["gtin", input.gtin],
    ["gtin12", input.gtin12],
  ];
  for (const [source, raw] of candidates) {
    const digits = String(raw ?? "").replace(/\D/g, "");
    if (!digits || /^0+$/.test(digits)) continue;
    if (isValidGtin(digits)) return { gtin: digits, source };
  }
  return null;
}

function parseAvailability(value: string | null | undefined): boolean {
  const raw = String(value ?? "").toLowerCase();
  if (!raw) return true;
  if (raw.includes("outofstock") || raw.includes("discontinued") || raw.includes("soldout")) return false;
  return raw.includes("instock") || raw.includes("preorder") || raw.includes("backorder");
}

function parseJsonLdProducts(html: string): Map<
  string,
  {
    gtin: string | null;
    gtinSource: string | null;
    name: string | null;
    sizeLabel: string | null;
    priceChf: number | null;
    inStock: boolean;
    imageUrl: string | null;
  }
> {
  const out = new Map<
    string,
    {
      gtin: string | null;
      gtinSource: string | null;
      name: string | null;
      sizeLabel: string | null;
      priceChf: number | null;
      inStock: boolean;
      imageUrl: string | null;
    }
  >();

  for (const match of html.matchAll(/\{"@type"\s*:\s*"Product"[\s\S]*?\}(?=\s*[,}\]])/g)) {
    const block = match[0];
    const sku = block.match(/"sku"\s*:\s*"([^"]+)"/)?.[1]?.trim();
    if (!sku) continue;
    const barcode = normalizeBaechliBarcode({
      gtin13: block.match(/"gtin13"\s*:\s*"(\d+)"/)?.[1],
      gtin14: block.match(/"gtin14"\s*:\s*"(\d+)"/)?.[1],
      gtin: block.match(/"gtin"\s*:\s*"(\d+)"/)?.[1],
      gtin12: block.match(/"gtin12"\s*:\s*"(\d+)"/)?.[1],
    });
    const offers = block.match(/"offers"\s*:\s*\{[\s\S]*?\}/)?.[0] ?? "";
    const priceRaw = offers.match(/"price"\s*:\s*([0-9.]+)/)?.[1];
    const priceChf = priceRaw ? Number.parseFloat(priceRaw) : null;
    out.set(sku, {
      gtin: barcode?.gtin ?? null,
      gtinSource: barcode?.source ?? null,
      name: block.match(/"name"\s*:\s*"([^"]+)"/)?.[1] ?? null,
      sizeLabel: block.match(/"size"\s*:\s*"([^"]+)"/)?.[1] ?? null,
      priceChf: Number.isFinite(priceChf) ? priceChf : null,
      inStock: parseAvailability(offers.match(/"availability"\s*:\s*"([^"]+)"/)?.[1]),
      imageUrl: block.match(/"image"\s*:\s*"([^"]+)"/)?.[1] ?? null,
    });
  }
  return out;
}

function parseBreadcrumbs(html: string): string[] {
  const crumb = html.match(/class="msw-breadcrumb"[\s\S]*?<\/ol>/i)?.[0] ?? "";
  return [...crumb.matchAll(/itemprop="name">([^<]+)</gi)]
    .map((m) => decodeHtml(m[1].replace(/\s+/g, " ").trim()))
    .filter((b) => b && !/^shop$/i.test(b));
}

function parseBrand(html: string): string | null {
  const gaBrand = html.match(/"item_brand"\s*:\s*"([^"]+)"/)?.[1];
  if (gaBrand) return decodeHtml(gaBrand.trim());
  const altBrand = html.match(/"brand"\s*:\s*\{\s*"@type"\s*:\s*"Brand"\s*,\s*"name"\s*:\s*"([^"]+)"/)?.[1];
  if (altBrand) return decodeHtml(altBrand.trim());
  const imgAlt = html.match(/Images\/shop\/brands\/[^"]+"[^>]*alt="([^"]+)"/i)?.[1];
  return imgAlt ? decodeHtml(imgAlt.trim()) : null;
}

export function parseBaechliProductHtml(html: string, productUrl: string): BaechliProduct | null {
  const jsonLdBySku = parseJsonLdProducts(html);
  const name =
    decodeHtml(html.match(/<h1[^>]*>([^<]+)</i)?.[1]?.trim() ?? "") ||
    [...jsonLdBySku.values()].find((v) => v.name)?.name ||
    "";
  if (!name) return null;

  const brand = parseBrand(html);
  const breadcrumbs = parseBreadcrumbs(html);
  const productType = breadcrumbs.slice(0, 4).join(" > ") || null;
  const variants: BaechliVariant[] = [];
  const seenSkus = new Set<string>();

  for (const match of html.matchAll(
    /<div[^>]*data-variantnumber="([^"]+)"[^>]*data-price="([^"]+)"[^>]*>/gi
  )) {
    const sku = match[1].trim();
    if (!sku || seenSkus.has(sku)) continue;
    seenSkus.add(sku);
    const block = match[0];
    const sizeLabel =
      block.match(/data-variantname="([^"]*)"/)?.[1]?.trim() ||
      jsonLdBySku.get(sku)?.sizeLabel ||
      null;
    const priceRaw = block.match(/data-price="([^"]+)"/)?.[1] ?? match[2];
    const priceChf = Number.parseFloat(String(priceRaw));
    const jsonLd = jsonLdBySku.get(sku);
    variants.push({
      sku,
      sizeLabel: sizeLabel ? decodeHtml(sizeLabel) : null,
      priceChf: Number.isFinite(priceChf) && priceChf > 0 ? priceChf : jsonLd?.priceChf ?? null,
      inStock: jsonLd?.inStock ?? true,
      gtin: jsonLd?.gtin ?? null,
      gtinSource: jsonLd?.gtinSource ?? null,
      imageUrl: jsonLd?.imageUrl ?? null,
    });
  }

  if (!variants.length) {
    for (const [sku, jsonLd] of jsonLdBySku.entries()) {
      if (seenSkus.has(sku)) continue;
      seenSkus.add(sku);
      variants.push({
        sku,
        sizeLabel: jsonLd.sizeLabel,
        priceChf: jsonLd.priceChf,
        inStock: jsonLd.inStock,
        gtin: jsonLd.gtin,
        gtinSource: jsonLd.gtinSource,
        imageUrl: jsonLd.imageUrl,
      });
    }
  }

  if (!variants.length) return null;
  return { productUrl, name, brand, productType, variants };
}

export function isBaechliProductUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return /\/de\//.test(path) && /-\d{5,}/.test(path);
  } catch {
    return false;
  }
}

export class BaechliClient {
  constructor(private readonly baseUrl: string) {}

  private siteRoot(): string {
    try {
      const u = new URL(this.baseUrl);
      return `${u.protocol}//${u.host}`;
    } catch {
      return this.baseUrl.replace(/\/+$/, "");
    }
  }

  async fetchText(url: string, opts?: { delay?: boolean }): Promise<string> {
    const cfg = baechliConfig();
    const useDelay = opts?.delay !== false && cfg.requestDelayMs > 0;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": cfg.userAgent,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "de-CH,de;q=0.9,en;q=0.8",
          },
          signal: AbortSignal.timeout(cfg.requestTimeoutMs),
          redirect: "follow",
        });
        if (res.status === 429) {
          await sleep(Math.min(3000 * 2 ** attempt, 60_000));
          lastErr = new Error("429");
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (useDelay) await sleep(cfg.requestDelayMs);
        return text;
      } catch (err) {
        lastErr = err;
        await sleep(Math.min(3000 * 2 ** attempt, 60_000));
      }
    }
    throw new Error(`GET failed ${url}: ${lastErr}`);
  }

  async listDeProductUrls(maxProducts?: number): Promise<string[]> {
    const siteRoot = this.siteRoot();
    const indexXml = await this.fetchText(`${siteRoot}/sitemap.xml`, { delay: false });
    const sitemapUrls = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1].trim());
    const out: string[] = [];
    const seen = new Set<string>();

    const shards = await Promise.all(
      sitemapUrls.map(async (sitemapUrl) => {
        const xml = await this.fetchText(sitemapUrl, { delay: false });
        return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1].trim());
      })
    );

    for (const locs of shards) {
      for (const url of locs) {
        if (!isBaechliProductUrl(url)) continue;
        const canonical = url.split("?")[0];
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        out.push(canonical);
        if (maxProducts && out.length >= maxProducts) return out;
      }
    }
    return out;
  }

  async fetchProduct(productUrl: string): Promise<BaechliProduct | null> {
    const html = await this.fetchText(productUrl);
    return parseBaechliProductHtml(html, productUrl);
  }
}
