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
  if (/(women|womens|woman|female|\bw\b)/.test(lower)) return "women";
  if (/(youth|kids|kid|gs|grade school|child|children)/.test(lower)) return "youth";
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
 * EU → US via KickDB fallback charts. Used when StockX size picker has no EU tab.
 */
export function convertEuToUs(
  sizeEU: string,
  opts?: { brand?: string | null; title?: string | null; genderHint?: string | null }
): string | null {
  const eu = normalizeEu(sizeEU);
  if (!eu) return null;
  const brand = opts?.brand || inferBrandFromTitle(opts?.title) || null;
  const chart = getChart(brand, opts?.genderHint ?? opts?.title ?? null, sizeEU);
  if (!chart) return null;
  const key = euKey(eu);
  const index = chart.sizes.EU.findIndex((entry) => euKey(entry) === key);
  if (index < 0 || index >= chart.sizes.US.length) return null;
  const us = chart.sizes.US[index];
  return us ? String(us).trim() : null;
}

export function buildStockxBuyUrl(slug: string, sizeUS?: string | null): string {
  const base = `https://stockx.com/fr-fr/${slug.replace(/^\/+/, "")}`;
  if (!sizeUS) return base;
  const sizeParam = encodeURIComponent(String(sizeUS).trim());
  return `${base}?size=${sizeParam}`;
}
