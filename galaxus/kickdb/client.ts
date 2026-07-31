import {
  KICKDB_API_BASE_URL,
  KICKDB_API_KEY,
  KICKDB_API_KEY_HEADER,
  KICKDB_API_KEY_PREFIX,
} from "../config";
import { FALLBACK_SIZE_CHARTS, type SizeChartEntry } from "@/galaxus/kickdb/sizeCharts";
import { normalizeSize as normalizeSizeValue } from "@/app/lib/normalize";
import { validateGtin } from "@/app/lib/normalize";
import { gtinCandidates, gtinEquals } from "@/shopify/restock/gtinNormalize";

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

type KickDbSearchResponse = {
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

function normalizeIdentifierKind(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function cleanIdentifierDigits(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\D/g, "");
}

function acceptGtinDigits(value: unknown): string | null {
  const clean = cleanIdentifierDigits(value);
  if (!clean || !validateGtin(clean)) return null;
  return clean;
}

/** ITF-14 → strip leading zeros so it aligns with UPC (12-digit) when possible. */
function normalizeItfIdentifier(value: unknown): string | null {
  const digits = cleanIdentifierDigits(value);
  if (!digits) return null;
  const stripped = digits.replace(/^0+/, "") || "0";
  return acceptGtinDigits(stripped);
}

function findIdentifierByKind(
  entries: Array<{ identifier?: string | null; identifier_type?: string | null }>,
  pred: (kind: string) => boolean
): string | null {
  for (const entry of entries) {
    const kind = normalizeIdentifierKind(entry.identifier_type);
    if (!pred(kind)) continue;
    const accepted = acceptGtinDigits(entry.identifier);
    if (accepted) return accepted;
  }
  return null;
}

function pickFromIdentifierEntries(
  entries: Array<{ identifier?: string | null; identifier_type?: string | null }>
): string | null {
  const upc = findIdentifierByKind(entries, (kind) => kind === "UPC" || kind.startsWith("UPC"));
  if (upc) return upc;

  for (const entry of entries) {
    const kind = normalizeIdentifierKind(entry.identifier_type);
    if (kind !== "ITF" && !kind.startsWith("ITF")) continue;
    const normalized = normalizeItfIdentifier(entry.identifier);
    if (normalized) return normalized;
  }

  const ean = findIdentifierByKind(entries, (kind) => kind === "EAN" || kind.startsWith("EAN"));
  if (ean) return ean;

  const gtin = findIdentifierByKind(entries, (kind) => kind === "GTIN" || kind.startsWith("GTIN"));
  if (gtin) return gtin;

  return null;
}

function pickEanFromIdentifierEntries(
  entries: Array<{ identifier?: string | null; identifier_type?: string | null }>
): string | null {
  return findIdentifierByKind(entries, (kind) => kind === "EAN" || kind.startsWith("EAN"));
}

function pickEanFromIdentifierRecord(record: Record<string, string | string[]>): string | null {
  const asEntries = (keys: string[]) =>
    keys.flatMap((key) => {
      const raw = record[key];
      const values = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
      return values.map((identifier) => ({
        identifier,
        identifier_type: key,
      }));
    });

  return pickEanFromIdentifierEntries(asEntries(["ean", "ean13", "EAN", "EAN13"]));
}

function pickFromIdentifierRecord(record: Record<string, string | string[]>): string | null {
  const asEntries = (keys: string[]) =>
    keys.flatMap((key) => {
      const raw = record[key];
      const values = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
      return values.map((identifier) => ({
        identifier,
        identifier_type: key,
      }));
    });

  return pickFromIdentifierEntries([
    ...asEntries(["upc", "upca", "UPC", "UPCA"]),
    ...asEntries(["itf", "itf14", "ITF", "ITF14"]),
    ...asEntries(["ean", "ean13", "EAN", "EAN13"]),
    ...asEntries(["gtin", "GTIN"]),
  ]);
}

/**
 * Canonical barcode for feed keys (Decathlon/Galaxus STX_*).
 * Priority: UPC → ITF-14 (leading zeros stripped) → EAN-13 → GTIN-8.
 */
export function extractVariantGtin(variant?: KickDbVariantWithIdentifiers): string | null {
  if (!variant) return null;

  const identifiers = variant.identifiers;
  if (Array.isArray(identifiers) && identifiers.length > 0) {
    const picked = pickFromIdentifierEntries(identifiers);
    if (picked) return picked;
  } else if (identifiers && typeof identifiers === "object") {
    const picked = pickFromIdentifierRecord(identifiers as Record<string, string | string[]>);
    if (picked) return picked;
  }

  const topLevel = acceptGtinDigits(variant.gtin) ?? acceptGtinDigits(variant.ean);
  return topLevel;
}

/**
 * EAN-13 (or EAN-prefixed identifier_type) when present alongside UPC.
 * Stored on `KickDBVariant.ean` so EAN scans resolve while feed keys stay UPC-first.
 */
export function extractVariantEan(variant?: KickDbVariantWithIdentifiers): string | null {
  if (!variant) return null;

  const identifiers = variant.identifiers;
  if (Array.isArray(identifiers) && identifiers.length > 0) {
    const picked = pickEanFromIdentifierEntries(identifiers);
    if (picked) return picked;
  } else if (identifiers && typeof identifiers === "object") {
    const picked = pickEanFromIdentifierRecord(identifiers as Record<string, string | string[]>);
    if (picked) return picked;
  }

  return acceptGtinDigits(variant.ean);
}

/** Canonical feed GTIN (UPC-first) + secondary EAN for cross-barcode lookup. */
export function pickPersistedKickdbBarcodes(variant?: KickDbVariantWithIdentifiers): {
  gtin: string | null;
  ean: string | null;
} {
  const gtinRaw = extractVariantGtin(variant);
  const gtin = gtinRaw && validateGtin(gtinRaw) ? gtinRaw : null;
  const eanRaw = extractVariantEan(variant);
  let ean = eanRaw && validateGtin(eanRaw) ? eanRaw : null;
  if (ean && gtin && gtinEquals(ean, gtin)) ean = null;
  return { gtin, ean };
}

/** Match scanned GTIN against every identifier on a KickDB variant (EAN-13, UPC, GTIN-8, …). */
export function kickdbVariantMatchesGtin(
  variant: KickDbVariantWithIdentifiers | undefined,
  gtin: string
): boolean {
  if (!variant || !gtin) return false;
  const matchesId = (id: string | null | undefined): boolean =>
    Boolean(id) && gtinCandidates(gtin).some((c) => gtinEquals(id, c));

  if (matchesId(variant.gtin) || matchesId(variant.ean)) return true;

  const identifiers = variant.identifiers;
  if (Array.isArray(identifiers)) {
    for (const item of identifiers) {
      if (matchesId(item.identifier)) return true;
    }
  } else if (identifiers && typeof identifiers === "object") {
    for (const value of Object.values(identifiers as Record<string, string | string[]>)) {
      const arr = Array.isArray(value) ? value : [value];
      for (const id of arr) {
        if (typeof id === "string" && matchesId(id)) return true;
      }
    }
  }
  return false;
}

type SizeMatchContext = {
  brand?: string | null;
  gender?: string | null;
};

function normalizeBrandForChart(value?: string | null): string | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.includes("yeezy") && lower.includes("slide")) return "yeezyslide";
  if (lower.includes("yeezy") || lower.includes("yeez") || lower.includes("yzy")) return "adidas";
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

function buildTokensFromSizeValue(value?: string | null): string[] {
  if (!value) return [];
  const trimmed = value.toString().trim();
  if (!trimmed) return [];
  const tokens = new Set<string>();
  tokens.add(trimmed);
  expandSizeTokens(trimmed).forEach((token) => tokens.add(token));
  return Array.from(tokens);
}

function stripPrefix(value: string, prefix: RegExp): string {
  return value.replace(prefix, "").trim();
}

function normalizeEuSize(value: string): string {
  return stripPrefix(value, /^EU\s*/i);
}

function normalizeUsSize(value: string): string {
  let cleaned = value.trim();
  cleaned = cleaned.replace(/^US\s*M\s*/i, "");
  cleaned = cleaned.replace(/^US\s*W\s*/i, "");
  cleaned = cleaned.replace(/^US\s*/i, "");
  return cleaned.trim();
}

function extractEuSizes(variant: KickDbVariant): string[] {
  const values: string[] = [];
  const pushValue = (raw?: string | null) => {
    if (!raw) return;
    const cleaned = normalizeEuSize(String(raw));
    if (cleaned) values.push(cleaned);
  };
  if (Array.isArray(variant.sizes)) {
    for (const entry of variant.sizes) {
      const type = String(entry?.type ?? "").toLowerCase();
      if (type === "eu") pushValue(entry?.size ?? null);
    }
  }
  pushValue(variant.size_eu ?? null);
  if (variant.size && String(variant.size_type ?? "").toLowerCase().includes("eu")) {
    pushValue(variant.size);
  }
  return values;
}

function extractUsSizes(variant: KickDbVariant): string[] {
  const values: string[] = [];
  const pushValue = (raw?: string | null) => {
    if (!raw) return;
    const cleaned = normalizeUsSize(String(raw));
    if (cleaned) values.push(cleaned);
  };
  if (Array.isArray(variant.sizes)) {
    for (const entry of variant.sizes) {
      const type = String(entry?.type ?? "").toLowerCase();
      if (type === "us m" || type === "us w" || type === "us") {
        pushValue(entry?.size ?? null);
      }
    }
  }
  pushValue(variant.size_us ?? null);
  if (variant.size && String(variant.size_type ?? "").toLowerCase().includes("us")) {
    pushValue(variant.size);
  }
  return values;
}

function convertUsToEu(usValue: string, context?: SizeMatchContext): string | null {
  const chart = getChart(context?.brand ?? null, context?.gender ?? null, usValue);
  if (!chart) return null;
  const normalized = normalizeUsSize(usValue).replace(/\s+/g, "");
  if (!normalized) return null;
  const index = chart.sizes.US.findIndex(
    (entry) => entry.replace(/\s+/g, "") === normalized
  );
  if (index < 0 || index >= chart.sizes.EU.length) return null;
  return chart.sizes.EU[index] ?? null;
}

function buildTargetSizeTokens(sizeRaw?: string | null): string[] {
  const normalized = normalizeSizeValue(sizeRaw ?? null);
  if (!normalized) return [];
  const cleaned = stripPrefix(normalized, /^EU\s*/i);
  return buildTokensFromSizeValue(cleaned);
}

function getVariantSizeCandidates(variant: KickDbVariant, context?: SizeMatchContext): string[] {
  const euValues = extractEuSizes(variant);
  if (euValues.length) {
    return euValues.flatMap((value) => buildTokensFromSizeValue(value));
  }

  const usValues = extractUsSizes(variant);
  const tokens = new Set<string>();
  for (const usValue of usValues) {
    const converted = convertUsToEu(usValue, context);
    if (converted) {
      buildTokensFromSizeValue(converted).forEach((token) => tokens.add(token));
    }
  }
  if (tokens.size > 0) return Array.from(tokens);

  const fallbackValues: Array<string> = [];
  if (variant.size) fallbackValues.push(variant.size);
  if (Array.isArray(variant.sizes)) {
    for (const entry of variant.sizes) {
      if (entry?.size) fallbackValues.push(String(entry.size));
    }
  }
  fallbackValues.forEach((value) =>
    buildTokensFromSizeValue(value).forEach((token) => tokens.add(token))
  );
  return Array.from(tokens);
}

/** Best EU size title for Shopify (sizes[] / size_eu / US→EU chart). */
export function extractKickdbVariantEuSize(
  variant: KickDbVariant,
  context?: SizeMatchContext
): string | null {
  const euValues = extractEuSizes(variant);
  if (euValues.length) return euValues[0]!;

  for (const usValue of extractUsSizes(variant)) {
    const converted = convertUsToEu(usValue, context);
    if (converted) return converted;
  }

  return null;
}

function matchVariantBySize(
  variants: KickDbVariant[] = [],
  sizeRaw?: string | null,
  context?: SizeMatchContext
): KickDbVariant | null {
  const matches = matchVariantsBySize(variants, sizeRaw ?? null, context);
  return matches[0] ?? null;
}

export function matchVariantsBySize(
  variants: KickDbVariant[] = [],
  sizeRaw?: string | null,
  context?: SizeMatchContext
): KickDbVariant[] {
  const targetTokens = new Set(buildTargetSizeTokens(sizeRaw ?? null));
  if (!variants.length) return [];
  if (targetTokens.size === 0) return variants.slice(0, 1);
  return variants.filter((variant) => {
    const candidateTokens = getVariantSizeCandidates(variant, context);
    return candidateTokens.some((token) => targetTokens.has(token));
  });
}

