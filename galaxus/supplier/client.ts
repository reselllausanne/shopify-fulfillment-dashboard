import {
  GOLDEN_SUPPLIER_API_BASE_URL,
  GOLDEN_SUPPLIER_API_KEY,
  GOLDEN_SUPPLIER_API_KEY_HEADER,
  GOLDEN_SUPPLIER_API_KEY_PREFIX,
} from "../config";
import type { GoldenFlatSize, SupplierAuthConfig, SupplierCatalogItem, SupplierClient } from "./types";

const GOLDEN_SUPPLIER_KEY = "golden";

function buildAuthConfig(): SupplierAuthConfig {
  return {
    baseUrl: GOLDEN_SUPPLIER_API_BASE_URL.replace(/\/$/, ""),
    apiKey: GOLDEN_SUPPLIER_API_KEY,
    apiKeyHeader: GOLDEN_SUPPLIER_API_KEY_HEADER,
    apiKeyPrefix: GOLDEN_SUPPLIER_API_KEY_PREFIX,
  };
}

function buildHeaders(auth: SupplierAuthConfig): HeadersInit {
  if (!auth.apiKey) {
    throw new Error("Missing GOLDEN_SUPPLIER_API_KEY");
  }
  return {
    "Content-Type": "application/json",
    [auth.apiKeyHeader]: `${auth.apiKeyPrefix}${auth.apiKey}`,
  };
}

async function fetchJson<T>(url: string, auth: SupplierAuthConfig): Promise<T> {
  const response = await fetch(url, { headers: buildHeaders(auth) });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Golden supplier request failed (${response.status}): ${body}`);
  }
  return response.json() as Promise<T>;
}

function parseNumber(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntValue(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapFlatSize(item: GoldenFlatSize): SupplierCatalogItem {
  const imageUrls: string[] = [];
  if (item.image_full_url) imageUrls.push(item.image_full_url);
  if (item.image && item.image !== item.image_full_url) imageUrls.push(item.image);

  return {
    supplierVariantId: `${GOLDEN_SUPPLIER_KEY}:${item.id}`,
    supplierSku: item.sku,
    price: parseNumber(item.offer_price ?? item.presented_price ?? null),
    stock: parseIntValue(item.available_quantity),
    sizeRaw: item.size_eu ?? item.size_us ?? null,
    images: imageUrls,
    leadTimeDays: null,
    sourcePayload: item,
  };
}

async function fetchAssortmentFlat(auth: SupplierAuthConfig): Promise<GoldenFlatSize[]> {
  const url = `${auth.baseUrl}/assortment-flat/`;
  return fetchJson<GoldenFlatSize[]>(url, auth);
}

export function createGoldenSupplierClient(): SupplierClient {
  const auth = buildAuthConfig();
  return {
    supplierKey: GOLDEN_SUPPLIER_KEY,
    async fetchCatalog() {
      const items = await fetchAssortmentFlat(auth);
      return items.map(mapFlatSize);
    },
    async fetchStockAndPrice() {
      const items = await fetchAssortmentFlat(auth);
      return items.map(mapFlatSize);
    },
  };
}
