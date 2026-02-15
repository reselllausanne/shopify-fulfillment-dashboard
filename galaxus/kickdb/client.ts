import {
  KICKDB_API_BASE_URL,
  KICKDB_API_KEY,
  KICKDB_API_KEY_HEADER,
  KICKDB_API_KEY_PREFIX,
} from "../config";
import { FALLBACK_SIZE_CHARTS, type SizeChartEntry } from "./sizeCharts";

type KickDbProduct = {
  id: string;
  title?: string;
  sku?: string;
  slug?: string;
  variants?: KickDbVariant[];
};

type KickDbVariant = {
  id?: string;
  size?: string;
  size_type?: string;
  size_us?: string;
  size_eu?: string;
  sizes?: Array<{ size?: string | null; type?: string | null }>;
  identifiers?: Record<string, string | string[]>;
  gtin?: string;
  ean?: string;
};

export type KickDbSearchResponse = {
  data: KickDbProduct[];
  meta?: { total?: number };
};

type KickDbIdentifier = {
  identifier: string;
  identifier_type: string;
};

type KickDbVariantWithIdentifiers = KickDbVariant & {
  identifiers?: KickDbIdentifier[] | Record<string, string | string[]>;
};

function buildHeaders(): HeadersInit {
  if (!KICKDB_API_KEY) {
    throw new Error("Missing KICKDB_API_KEY");
  }
  return {
    "Content-Type": "application/json",
    [KICKDB_API_KEY_HEADER]: `${KICKDB_API_KEY_PREFIX}${KICKDB_API_KEY}`,
  };
}

export async function searchStockxProducts(query: string): Promise<KickDbSearchResponse> {
  const baseUrl = KICKDB_API_BASE_URL.replace(/\/$/, "");
  const url = new URL(`${baseUrl}/stockx/products`);
  url.searchParams.set("query", query);

  const response = await fetch(url.toString(), { headers: buildHeaders() });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`KickDB request failed (${response.status}): ${body}`);
  }
  return response.json() as Promise<KickDbSearchResponse>;
}

export async function fetchStockxProductByIdOrSlugRaw(
  idOrSlug: string
): Promise<{ product: KickDbProduct; raw: unknown }> {
  const baseUrl = KICKDB_API_BASE_URL.replace(/\/$/, "");
  const url = new URL(`${baseUrl}/stockx/products/${idOrSlug}`);
  url.searchParams.set("currency", "CHF");
  url.searchParams.set("market", "CH");
  url.searchParams.set("display[variants]", "true");
  url.searchParams.set("display[traits]", "true");
  url.searchParams.set("display[identifiers]", "true");
  url.searchParams.set("display[prices]", "true");

  const response = await fetch(url.toString(), { headers: buildHeaders() });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`KickDB request failed (${response.status}): ${body}`);
  }
  const data = (await response.json()) as any;
  const product = (data?.product ?? data?.data ?? data) as KickDbProduct;
  return { product, raw: data };
}

export async function fetchStockxProductByIdOrSlug(idOrSlug: string): Promise<KickDbProduct> {
  const { product } = await fetchStockxProductByIdOrSlugRaw(idOrSlug);
  return product;
}

export function extractVariantGtin(variant?: KickDbVariantWithIdentifiers): string | null {
  if (!variant) return null;
  if (variant.gtin) return variant.gtin;
  if (variant.ean) return variant.ean;
  const identifiers = variant.identifiers;
  if (Array.isArray(identifiers)) {
    const gtin = identifiers.find((item) =>
      ["GTIN", "EAN", "UPC"].includes(item.identifier_type.toUpperCase())
    );
    return gtin?.identifier ?? null;
  }
  if (identifiers && typeof identifiers === "object") {
    const candidates = [
      (identifiers as Record<string, string | string[]>).gtin,
      (identifiers as Record<string, string | string[]>).ean,
      (identifiers as Record<string, string | string[]>).GTIN,
      (identifiers as Record<string, string | string[]>).EAN,
    ].flat();
    const value = Array.isArray(candidates) ? candidates[0] : candidates;
    return typeof value === "string" ? value : null;
  }
  return null;
}

export function normalizeSize(value?: string | null): string | null {
  if (!value) return null;
  const raw = value.toString().trim().toUpperCase();
  const match = raw.match(/(\d+(\.\d+)?)/);
  return match?.[1] ?? raw;
}

type SizeMatchContext = {
  brand?: string | null;
  gender?: string | null;
};

function normalizeBrandForChart(value?: string | null): string | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.includes("yeezy") && lower.includes("slide")) return "yeezyslide";
  if (lower.includes("yeezy") || lower.includes("yeez")) return "adidas";
  if (lower.includes("jordan")) return "air jordan";
  return lower;
}

function normalizeGenderForChart(value?: string | null, sizeRaw?: string | null): "men" | "women" | "youth" {
  const lower = (value ?? "").toLowerCase();
  if (/(women|womens|woman|female|w\b)/.test(lower)) return "women";
  if (/(youth|kids|kid|gs|grade school|child|children)/.test(lower)) return "youth";
  const size = (sizeRaw ?? "").toUpperCase();
  if (/(^|\b)\d+(\.\d+)?\s*Y\b/.test(size)) return "youth";
  if (/(^|\b)GS\b/.test(size)) return "youth";
  return "men";
}

function getChart(brand?: string | null, gender?: string | null, sizeRaw?: string | null): SizeChartEntry | null {
  const normalizedBrand = normalizeBrandForChart(brand);
  if (!normalizedBrand) return null;
  const normalizedGender = normalizeGenderForChart(gender, sizeRaw);
  return (
    FALLBACK_SIZE_CHARTS.find(
      (entry) => entry.brand === normalizedBrand && entry.gender === normalizedGender
    ) ?? null
  );
}

function normalizeFractionalSize(value: string): string[] {
  const tokens = new Set<string>();
  const raw = value.trim();
  tokens.add(raw.replace(/\s+/g, ""));
  const fraction = raw.match(/(\d+)\s*(1\/3|2\/3)/i);
  if (fraction) {
    const base = Number(fraction[1]);
    const decimal = fraction[2] === "1/3" ? base + 1 / 3 : base + 2 / 3;
    tokens.add(decimal.toFixed(2));
    tokens.add(decimal.toFixed(1));
  }
  return Array.from(tokens);
}

function expandSizeTokens(value: string): string[] {
  const cleaned = value.trim().toUpperCase();
  const normalized = cleaned.replace(/\bWIDE\b/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const tokens = new Set<string>();

  if (/(^|[^A-Z])(XXS|XS|S|M|L|XL|XXL|XXXL|OS|ONE SIZE|O\/S)/i.test(normalized)) {
    tokens.add(normalized.replace(/\s+/g, ""));
  }

  const withoutPrefix = normalized.replace(/^(EU|US|UK|ASIA)\s+/i, "");
  normalizeFractionalSize(withoutPrefix).forEach((token) => tokens.add(token));

  const numericMatch = withoutPrefix.match(/(\d+(\.\d+)?)/);
  if (numericMatch?.[1]) tokens.add(numericMatch[1]);

  if (/(^|[^A-Z])(\d+(\.\d+)?)(Y|GS)$/i.test(normalized)) {
    const youthMatch = normalized.match(/(\d+(\.\d+)?)/);
    if (youthMatch?.[1]) {
      tokens.add(`${youthMatch[1]}Y`);
      tokens.add(youthMatch[1]);
    }
  }

  return Array.from(tokens);
}

function inferSizeSystem(value: string): "EU" | "US" | "UK" | null {
  const upper = value.toUpperCase();
  if (/(^|[^A-Z])(\d+(\.\d+)?)(Y|GS)\b/.test(upper)) return "US";
  if (upper.includes("EU")) return "EU";
  if (upper.includes("US")) return "US";
  if (upper.includes("UK")) return "UK";
  return null;
}

function convertSizeUsingChart(
  chart: SizeChartEntry | null,
  fromSystem: "US" | "EU",
  value: string
): string | null {
  if (!chart) return null;
  const fromList = chart.sizes[fromSystem];
  const toList = chart.sizes[fromSystem === "US" ? "EU" : "US"];
  const index = fromList.indexOf(value);
  if (index < 0 || index >= toList.length) return null;
  return toList[index] ?? null;
}

function buildTargetSizeTokens(sizeRaw?: string | null, context?: SizeMatchContext): string[] {
  if (!sizeRaw) return [];
  const tokens = new Set<string>(expandSizeTokens(sizeRaw));

  const chart = getChart(context?.brand ?? null, context?.gender ?? null, sizeRaw);
  const system = inferSizeSystem(sizeRaw);
  const stripped = sizeRaw.replace(/^(EU|US|UK|ASIA)\s+/i, "").trim();
  const normalizedValue = stripped.replace(/\s+/g, "");
  const baseValue =
    normalizedValue.match(/^\d+(\.\d+)?$/) || /(\d+(\.\d+)?)/.test(normalizedValue)
      ? normalizedValue.match(/(\d+(\.\d+)?)/)?.[1]
      : null;

  if (chart && baseValue) {
    if (system === "US") {
      const converted = convertSizeUsingChart(chart, "US", baseValue);
      if (converted) expandSizeTokens(converted).forEach((token) => tokens.add(token));
    } else if (system === "EU" || system === null) {
      const converted = convertSizeUsingChart(chart, "EU", baseValue);
      if (converted) expandSizeTokens(converted).forEach((token) => tokens.add(token));
    }
  }

  return Array.from(tokens);
}

function getVariantSizeCandidates(variant: KickDbVariant): string[] {
  const values: Array<string | null | undefined> = [
    variant.size_eu,
    variant.size_us,
    variant.size,
  ];
  if (Array.isArray(variant.sizes)) {
    for (const entry of variant.sizes) {
      if (entry?.size) values.push(entry.size);
    }
  }
  return values.flatMap((value) => (value ? expandSizeTokens(value) : [])).filter(Boolean);
}

export function matchVariantBySize(
  variants: KickDbVariant[] = [],
  sizeRaw?: string | null,
  context?: SizeMatchContext
): KickDbVariant | null {
  const targetTokens = new Set(buildTargetSizeTokens(sizeRaw ?? null, context));
  if (!variants.length) return null;
  if (targetTokens.size === 0) return variants[0] ?? null;
  return (
    variants.find((variant) => {
      const candidateTokens = getVariantSizeCandidates(variant);
      return candidateTokens.some((token) => targetTokens.has(token));
    }) ?? null
  );
}

