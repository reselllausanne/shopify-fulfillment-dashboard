/**
 * GTIN → official brand product page, via Google (SerpAPI).
 *
 * Brand PDP URLs do not contain the GTIN, but third-party pages (Amazon, sssports, …)
 * name the product with its style code ("Bq5453-001"). So:
 *   1. Google the GTIN (12/13/14-digit variants) → collect results naming a known brand + style code.
 *   2. Vote the most frequent style code.
 *   3. Google `site:<brand domain> <style code>` → first PDP URL on the brand domain.
 */

export type SearchResult = { link: string; title?: string; snippet?: string };
export type SearchFn = (query: string) => Promise<SearchResult[]>;

type BrandDef = {
  key: string;
  /** Matched against title/snippet (lowercase). */
  keywords: RegExp;
  /** Brand site hosts (suffix match). */
  hosts: string[];
  /** Style-code shape on that brand. */
  styleCode: RegExp;
  /** `site:` filter used for the official page search. */
  siteQuery: string;
  /** Free resolver (no search): URL that redirects to the PDP for a style code. */
  directUrl?: (styleCode: string) => string;
};

export const BRANDS: BrandDef[] = [
  {
    key: "nike",
    keywords: /\b(nike|jordan)\b/i,
    hosts: ["nike.com"],
    styleCode: /\b([A-Z]{1,2}\d{4}-\d{3})\b/gi,
    siteQuery: "site:nike.com/ch",
    // Verified: nike.com/ch/t/x/<STYLE> 301s to the real PDP (slug + id resolved by Nike).
    directUrl: (code) => `https://www.nike.com/ch/t/x/${code}`,
  },
  {
    key: "adidas",
    keywords: /\badidas\b/i,
    hosts: ["adidas.ch", "adidas.com"],
    styleCode: /\b([A-Z]{1,2}\d{4,5})\b/g,
    siteQuery: "site:adidas.ch",
  },
  {
    key: "puma",
    keywords: /\bpuma\b/i,
    hosts: ["puma.com"],
    styleCode: /\b(\d{6}[ -]\d{2})\b/g,
    siteQuery: "site:ch.puma.com",
  },
  {
    key: "newbalance",
    keywords: /\bnew balance\b/i,
    hosts: ["newbalance.ch", "newbalance.com"],
    styleCode: /\b([A-Z]{2,4}\d{3,5}[A-Z]{0,3})\b/g,
    siteQuery: "site:newbalance.ch",
  },
];

/** GTIN spellings seen in the wild: as stored, without leading zeros, 12/13/14 digits. */
export function gtinSearchVariants(gtin: string): string[] {
  const d = String(gtin ?? "").replace(/\D/g, "");
  if (!d) return [];
  const stripped = d.replace(/^0+/, "");
  const out = new Set<string>();
  for (const len of [12, 13, 14]) {
    if (stripped.length <= len) out.add(stripped.padStart(len, "0"));
  }
  out.add(d);
  // UPC-A (12) first: most US-origin brand listings use it.
  return Array.from(out).sort((a, b) => (a.length === 12 ? -1 : b.length === 12 ? 1 : 0));
}

export function detectBrand(results: SearchResult[]): BrandDef | null {
  const score = new Map<string, number>();
  for (const r of results) {
    const text = `${r.title ?? ""} ${r.snippet ?? ""} ${r.link}`;
    for (const b of BRANDS) if (b.keywords.test(text)) score.set(b.key, (score.get(b.key) ?? 0) + 1);
  }
  let best: BrandDef | null = null;
  let bestN = 0;
  for (const b of BRANDS) {
    const n = score.get(b.key) ?? 0;
    if (n > bestN) {
      best = b;
      bestN = n;
    }
  }
  return best;
}

/** Most frequent style code among results that name the brand. */
export function voteStyleCode(results: SearchResult[], brand: BrandDef): string | null {
  const votes = new Map<string, number>();
  for (const r of results) {
    const text = `${r.title ?? ""} ${r.snippet ?? ""} ${decodeURIComponent(r.link)}`;
    if (!brand.keywords.test(text)) continue;
    const seen = new Set<string>();
    for (const m of text.matchAll(new RegExp(brand.styleCode.source, brand.styleCode.flags.includes("i") ? "gi" : "g"))) {
      const code = m[1].toUpperCase();
      if (seen.has(code)) continue;
      seen.add(code);
      votes.set(code, (votes.get(code) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [code, n] of votes) {
    if (n > bestN) {
      best = code;
      bestN = n;
    }
  }
  return best;
}

export function pickOfficialPage(results: SearchResult[], brand: BrandDef, styleCode: string): string | null {
  const code = styleCode.toUpperCase();
  const hostOk = (link: string) => {
    try {
      const h = new URL(link).hostname.toLowerCase();
      return brand.hosts.some((x) => h === x || h.endsWith(`.${x}`));
    } catch {
      return false;
    }
  };
  const onBrand = results.filter((r) => hostOk(r.link));
  const exact = onBrand.find((r) => decodeURIComponent(r.link).toUpperCase().includes(code));
  return (exact ?? onBrand[0])?.link ?? null;
}

export type FindBrandPageResult = {
  ok: boolean;
  brand: string | null;
  styleCode: string | null;
  url: string | null;
  evidence: string[];
  error?: string;
};

export async function findBrandPageByGtin(gtin: string, search: SearchFn): Promise<FindBrandPageResult> {
  const evidence: string[] = [];
  const found: SearchResult[] = [];
  for (const v of gtinSearchVariants(gtin)) {
    const res = await search(v);
    found.push(...res);
    evidence.push(`search ${v}: ${res.length} résultats`);
    const brand = detectBrand(found);
    if (brand && voteStyleCode(found, brand)) break;
  }
  const brand = detectBrand(found);
  if (!brand) return { ok: false, brand: null, styleCode: null, url: null, evidence, error: "brand_not_found" };
  const styleCode = voteStyleCode(found, brand);
  if (!styleCode) return { ok: false, brand: brand.key, styleCode: null, url: null, evidence, error: "style_code_not_found" };
  evidence.push(`brand=${brand.key} styleCode=${styleCode}`);

  if (brand.directUrl) {
    evidence.push("official page via direct style URL (0 search call)");
    return { ok: true, brand: brand.key, styleCode, url: brand.directUrl(styleCode), evidence };
  }

  const official = await search(`${brand.siteQuery} ${styleCode}`);
  const url = pickOfficialPage(official, brand, styleCode);
  if (!url) return { ok: false, brand: brand.key, styleCode, url: null, evidence, error: "official_page_not_found" };
  return { ok: true, brand: brand.key, styleCode, url, evidence };
}

/** SerpAPI Google web search (CH). */
export function serpApiSearch(apiKey: string): SearchFn {
  return async (q) => {
    const url =
      `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}` +
      `&gl=ch&hl=de&num=10&api_key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status}`);
    const data = (await res.json()) as { organic_results?: Array<{ link: string; title?: string; snippet?: string }>; error?: string };
    if (data.error && !data.organic_results) {
      if (/hasn't returned any results/i.test(data.error)) return [];
      throw new Error(`SerpAPI: ${data.error}`);
    }
    return (data.organic_results ?? []).map((r) => ({ link: r.link, title: r.title, snippet: r.snippet }));
  };
}
