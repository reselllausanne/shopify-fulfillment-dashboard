/**
 * Parse a nike.com product page (PDP) into catalog data. Source: `__NEXT_DATA__`
 * `props.pageProps.selectedProduct` (brand, style-color, per-size GTIN + EU label, images),
 * with the schema.org JSON-LD `ProductGroup` as fallback for brand/name/GTIN.
 * Price + stock are NOT read here: operator types them.
 */

export type ParsedNikeSize = {
  /** Nike label (2C, 10C, 38.5 ...). */
  nikeLabel: string;
  /** EU size shown on Nike (17, 18.5 ...) — what Shopify/Galaxus use. */
  euSize: string;
  gtin: string;
};

export type ParsedNikeProduct = {
  brand: string;
  name: string;
  /** Nike subtitle (e.g. "Schuh für Babys und Kleinkinder"). */
  subtitle: string | null;
  /** Style-color, e.g. BQ5453-001. */
  sku: string;
  color: string | null;
  images: string[];
  sizes: ParsedNikeSize[];
  productType: string | null;
  genders: string[];
  /** Nike list price (info only, never used as sell price). */
  nikePrice: number | null;
  sourceUrl: string | null;
};

function extractJson(html: string, re: RegExp): unknown | null {
  const m = html.match(re);
  if (!m?.[1]) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function asArray<T>(v: T | T[] | null | undefined): T[] {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}

export function parseNikeHtml(html: string, sourceUrl?: string): ParsedNikeProduct {
  const next = extractJson(html, /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/) as any;
  const ld = extractJson(html, /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/) as any;
  const group = asArray(ld).find((o: any) => o?.["@type"] === "ProductGroup") ?? null;
  const sel = next?.props?.pageProps?.selectedProduct ?? null;

  const sku = String(sel?.styleColor ?? group?.hasVariant?.[0]?.mpn ?? "").trim();
  const brandRaw = group?.brand?.name ?? sel?.brands?.[0] ?? "";
  const brand = String(brandRaw).trim();
  const title = String(sel?.productInfo?.title ?? "").trim();
  const subtitle = String(sel?.productInfo?.subtitle ?? "").trim();
  const name =
    title || String(group?.name ?? "").replace(/^Nike\s+/i, "").trim() || "";

  const sizes: ParsedNikeSize[] = [];
  for (const s of asArray<any>(sel?.sizes)) {
    if (s?.status && s.status !== "ACTIVE") continue;
    const gtin = String(s?.gtins?.[0]?.gtin ?? "").trim();
    const nikeLabel = String(s?.label ?? "").trim();
    const euSize = String(s?.localizedLabel ?? "").trim();
    if (!nikeLabel || !gtin) continue;
    sizes.push({ nikeLabel, euSize, gtin });
  }
  if (sizes.length === 0) {
    for (const v of asArray<any>(group?.hasVariant)) {
      if (String(v?.mpn ?? "").trim() !== sku) continue;
      const gtin = String(v?.gtin ?? "").trim();
      const nikeLabel = String(v?.size ?? "").trim();
      if (gtin && nikeLabel) sizes.push({ nikeLabel, euSize: "", gtin });
    }
  }

  const images: string[] = [];
  for (const c of asArray<any>(sel?.contentImages)) {
    const u = c?.properties?.squarish?.url ?? c?.properties?.portrait?.url;
    if (c?.cardType === "image" && typeof u === "string" && /^https?:\/\//.test(u) && !images.includes(u)) {
      images.push(u);
    }
  }
  if (images.length === 0) {
    for (const v of asArray<any>(group?.hasVariant)) {
      const u = v?.image;
      if (typeof u === "string" && /^https?:\/\//.test(u) && !images.includes(u)) images.push(u);
    }
  }

  const color = String(sel?.colorDescription ?? group?.hasVariant?.[0]?.color ?? "").trim() || null;
  const price = Number(sel?.prices?.currentPrice ?? group?.hasVariant?.[0]?.offers?.price);

  return {
    brand,
    name,
    subtitle: subtitle || null,
    sku,
    color,
    images,
    sizes,
    productType: sel?.productType ? String(sel.productType) : null,
    genders: asArray<string>(sel?.genders).map(String),
    nikePrice: Number.isFinite(price) ? price : null,
    sourceUrl: sourceUrl ?? sel?.pdpUrl?.url ?? null,
  };
}

export async function fetchNikeProduct(url: string): Promise<ParsedNikeProduct> {
  const u = new URL(url);
  if (!/(^|\.)nike\.com$/i.test(u.hostname)) throw new Error("URL non Nike");
  const res = await fetch(u.toString(), {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "accept-language": "de-CH,de;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Nike HTTP ${res.status}`);
  return parseNikeHtml(await res.text(), u.toString());
}

/** Merge parsed page + operator input (sell price CHF incl. VAT, stock per Nike size label). */
export function nikeToProductData(
  parsed: ParsedNikeProduct,
  input: { sellPrice: number; stockByNikeLabel: Record<string, number> }
) {
  return {
    brand: parsed.brand,
    name: parsed.name,
    subtitle: parsed.subtitle,
    genders: parsed.genders,
    sku: parsed.sku,
    color: parsed.color,
    images: parsed.images,
    sellPrice: input.sellPrice,
    productType: parsed.productType,
    sourceUrl: parsed.sourceUrl,
    // Only sizes the operator actually stocks; size title = EU size (Galaxus/Shopify).
    sizes: parsed.sizes
      .filter((s) => (input.stockByNikeLabel[s.nikeLabel] ?? 0) > 0)
      .map((s) => ({
        size: s.euSize || s.nikeLabel,
        gtin: s.gtin,
        stock: input.stockByNikeLabel[s.nikeLabel],
      })),
  };
}
