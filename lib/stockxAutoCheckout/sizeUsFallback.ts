import { FALLBACK_SIZE_CHARTS, type SizeChartEntry } from "@/galaxus/kickdb/sizeCharts";

function normalizeBrand(brand?: string | null): string | null {
  if (!brand) return null;
  const lower = brand.toLowerCase().trim();
  if (!lower) return null;
  if (lower.includes("jordan")) return "air jordan";
  if (lower.includes("yeezy") || lower.includes("yzy")) return "adidas";
  for (const entry of FALLBACK_SIZE_CHARTS) {
    if (lower.includes(entry.brand.toLowerCase())) return entry.brand.toLowerCase();
  }
  return lower;
}

function normalizeGender(value?: string | null, sizeRaw?: string | null): "men" | "women" | "youth" {
  const lower = (value ?? "").toLowerCase();
  // wmns = Galaxus "Wmns". Slug suffix -w = StockX women's footwear (…-black-w).
  // A lone "w" inside "white" must not match.
  if (/\b(women|womens|woman|wmns|wmn|female)\b/.test(lower)) return "women";
  if (/(?:-w|-wmns)$/.test(lower)) return "women";
  if (/\(\s*w\s*\)/.test(lower)) return "women";
  if (/(youth|kids|kid|gs|grade school|preschool|\bps\b|child|children)/.test(lower)) return "youth";
  const size = (sizeRaw ?? "").toUpperCase();
  if (/(^|\b)\d+(\.\d+)?\s*Y\b/.test(size)) return "youth";
  if (/(^|\b)GS\b/.test(size)) return "youth";
  return "men";
}

function getChart(brand?: string | null, gender?: string | null, sizeRaw?: string | null): SizeChartEntry | null {
  const normalizedBrand = normalizeBrand(brand);
  if (!normalizedBrand) return null;
  const g = normalizeGender(gender, sizeRaw);
  return (
    FALLBACK_SIZE_CHARTS.find(
      (entry) =>
        entry.brand.toLowerCase() === normalizedBrand.toLowerCase() && entry.gender === g
    ) ?? null
  );
}

function normalizeEu(value: string): string {
  return value
    .replace(/^EU\s*/i, "")
    .trim()
    .replace(/,/g, ".")
    .replace(/\s+/g, " ");
}

function euKey(value: string): string {
  return normalizeEu(value).replace(/\s+/g, "").toLowerCase();
}

/** Infer brand from product title for chart lookup. */
export function inferBrandFromTitle(title?: string | null): string | null {
  return normalizeBrand(title);
}

/**
 * Apparel letter sizes (S/M/L/XL…). StockX labels them as `S` or `US S` — not footwear EU→US.
 * Passthrough so checkout can select via the US/letter path (see selectSizeEuOrUs).
 */
export function apparelLetterSize(sizeRaw: string | null | undefined): string | null {
  const raw = String(sizeRaw ?? "")
    .replace(/^EU\s*/i, "")
    .replace(/^US\s*/i, "")
    .trim();
  if (!raw) return null;
  const m = raw.match(/^(XX?S|S|M|L|XX?L|XXXL|[2-4]XL)$/i);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  // Normalize xxxl → XXXL, 2xl → 2XL
  if (/^\dXL$/i.test(letter)) return letter.toUpperCase();
  return letter;
}

/**
 * EU → US via KickDB fallback charts. Used when StockX size picker has no EU tab.
 * Letter apparel sizes pass through as-is (StockX uses S/M/L / "US S").
 */
export function convertEuToUs(
  sizeEU: string,
  opts?: {
    brand?: string | null;
    title?: string | null;
    genderHint?: string | null;
    /** StockX urlKey. Women's footwear slugs end in `-w` even when the Galaxus title omits "Women's". */
    slug?: string | null;
    /**
     * Shopify "sizeEU" is just the variant label and may already be US. A plain number that
     * cannot be an adult EU size (< 20) and has no chart hit is taken as the US size itself.
     */
    assumeUsIfSmall?: boolean;
  }
): string | null {
  const eu = normalizeEu(sizeEU);
  if (!eu) return null;
  const letter = apparelLetterSize(eu);
  if (letter) return letter;
  const brand = opts?.brand || inferBrandFromTitle(opts?.title) || null;
  const genderSource = [opts?.genderHint, opts?.title, opts?.slug].filter(Boolean).join(" ");
  const chart = getChart(brand, genderSource || null, sizeEU);
  const key = euKey(eu);
  const index = chart ? chart.sizes.EU.findIndex((entry) => euKey(entry) === key) : -1;
  const us = chart && index >= 0 && index < chart.sizes.US.length ? chart.sizes.US[index] : null;
  const alreadyUs = !us && opts?.assumeUsIfSmall && /^\d{1,2}(\.5)?$/.test(eu) && Number(eu) < 20 ? eu : null;
  if (!us && !alreadyUs) return null;
  const usStr = String(us ?? alreadyUs).trim();
  // StockX women's footwear deep-links use "8W" not "8" (buy URL ?size=8W).
  const gender = normalizeGender(genderSource, sizeEU);
  if (gender === "women" && /^\d+(\.\d+)?$/.test(usStr)) return `${usStr}W`;
  // Youth / GS / PS deep-links use "3Y" not "3" (wrong token = size grid, not checkout).
  if (gender === "youth" && /^\d+(\.\d+)?$/.test(usStr)) return `${usStr}Y`;
  return usStr;
}

/** KickDB labels: "US W 8" → 8W, "US M 11" → 11. StockX ?size= value. */
export function stockxSizeQueryFromKickdbLabel(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const women = t.match(/US\s*W\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (women) return `${women[1]}W`;
  const men = t.match(/US\s*M\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (men) return men[1];
  if (/^[0-9]+(?:\.[0-9]+)?W$/i.test(t)) return t.toUpperCase().replace(/\s/g, "");
  if (/^[0-9]+(?:\.[0-9]+)?$/.test(t)) return t;
  return null;
}

export function buildStockxBuyUrl(slug: string, sizeUS?: string | null): string {
  const base = `https://stockx.com/fr-fr/${slug.replace(/^\/+/, "")}`;
  if (!sizeUS) return base;
  const sizeParam = encodeURIComponent(String(sizeUS).trim());
  return `${base}?size=${sizeParam}`;
}

/**
 * Direct StockX checkout deep-link (`/buy/{slug}?size=`). Prefer this for Galaxus
 * auto-buy — same action every time: land on checkout → pick lane → Place Order.
 * Avoids PDP scrape / Buy Now when size is already known.
 */
export function buildStockxCheckoutBuyUrl(slug: string, sizeUS?: string | null): string {
  const base = `https://stockx.com/fr-fr/buy/${slug.replace(/^\/+|\/+$/g, "")}`;
  if (!sizeUS) return base;
  return `${base}?size=${encodeURIComponent(String(sizeUS).trim())}`;
}
