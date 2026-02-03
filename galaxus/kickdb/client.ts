import {
  KICKDB_API_BASE_URL,
  KICKDB_API_KEY,
  KICKDB_API_KEY_HEADER,
  KICKDB_API_KEY_PREFIX,
} from "../config";

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

function getVariantSizeCandidates(variant: KickDbVariant): string[] {
  const values: Array<string | null | undefined> = [
    variant.size_eu,
    variant.size_us,
    variant.size,
  ];
  if (Array.isArray(variant.sizes)) {
    for (const entry of variant.sizes) {
      values.push(entry?.size ?? null);
    }
  }
  return values
    .map((value) => normalizeSize(value ?? null))
    .filter((value): value is string => Boolean(value));
}

export function matchVariantBySize(variants: KickDbVariant[] = [], sizeRaw?: string | null): KickDbVariant | null {
  const target = normalizeSize(sizeRaw);
  if (!variants.length) return null;
  if (!target) return variants[0] ?? null;
  return variants.find((variant) => getVariantSizeCandidates(variant).includes(target)) ?? null;
}

