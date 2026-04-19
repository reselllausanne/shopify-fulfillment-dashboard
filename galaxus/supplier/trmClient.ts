import {
  SUPPLIER_TRM_BASE_URL,
  SUPPLIER_TRM_PASSWORD,
  SUPPLIER_TRM_SYNC_MIN_INTERVAL_SEC,
  SUPPLIER_TRM_USERNAME,
} from "@/galaxus/config";

type TrmLoginResponse = {
  access_token?: string;
};

type TrmVariant = {
  variant_id: string;
  eu_size?: string | null;
  size?: string | null;
  price?: number | string | null;
  stock?: number | string | null;
  ean?: string | null;
};

type TrmProduct = {
  sku: string;
  brand?: string | null;
  name?: string | null;
  variants: TrmVariant[];
};

type TrmTokenCache = {
  token: string;
  expiresAtMs: number;
};

let tokenCache: TrmTokenCache | null = null;
let lastProductsFetchAtMs = 0;

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, "");
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.products)) return payload.products;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function parseProducts(payload: any): TrmProduct[] {
  const rows = toArray(payload);
  const products: TrmProduct[] = [];
  for (const row of rows) {
    const sku = String(row?.sku ?? "").trim();
    if (!sku) continue;
    const variantsRaw = Array.isArray(row?.variants) ? row.variants : [];
    const variants: TrmVariant[] = [];
    for (const variant of variantsRaw) {
      const variantId = String(variant?.variant_id ?? "").trim();
      if (!variantId) continue;
      variants.push({
        variant_id: variantId,
        eu_size: variant?.eu_size ?? null,
        size: variant?.size ?? null,
        price: parseNumber(variant?.price),
        stock: parseNumber(variant?.stock),
        ean: variant?.ean ? String(variant.ean).trim() : null,
      });
    }
    products.push({
      sku,
      brand: row?.brand ? String(row.brand).trim() : null,
      name: row?.name ? String(row.name).trim() : null,
      variants,
    });
  }
  return products;
}

function parseProduct(payload: any): TrmProduct | null {
  const sku = String(payload?.sku ?? "").trim();
  if (!sku) return null;
  const variantsRaw = Array.isArray(payload?.variants) ? payload.variants : [];
  const variants: TrmVariant[] = [];
  for (const variant of variantsRaw) {
    const variantId = String(variant?.variant_id ?? "").trim();
    if (!variantId) continue;
    variants.push({
      variant_id: variantId,
      eu_size: variant?.eu_size ?? null,
      size: variant?.size ?? null,
      price: parseNumber(variant?.price),
      stock: parseNumber(variant?.stock),
      ean: variant?.ean ? String(variant.ean).trim() : null,
    });
  }
  return {
    sku,
    brand: payload?.brand ? String(payload.brand).trim() : null,
    name: payload?.name ? String(payload.name).trim() : null,
    variants,
  };
}

function ensureConfigured() {
  if (!SUPPLIER_TRM_USERNAME || !SUPPLIER_TRM_PASSWORD) {
    throw new Error("Missing SUPPLIER_TRM_USERNAME or SUPPLIER_TRM_PASSWORD");
  }
}

async function login(baseUrl: string): Promise<string> {
  ensureConfigured();
  const response = await fetch(`${baseUrl}/v1/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: SUPPLIER_TRM_USERNAME,
      password: SUPPLIER_TRM_PASSWORD,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`TRM login failed (${response.status}): ${text}`);
  }
  const data = (await response.json()) as TrmLoginResponse;
  const token = String(data?.access_token ?? "").trim();
  if (!token) {
    throw new Error("TRM login did not return access_token");
  }
  tokenCache = {
    token,
    expiresAtMs: Date.now() + 24 * 60 * 60 * 1000,
  };
  return token;
}

async function getAccessToken(baseUrl: string): Promise<string> {
  if (tokenCache && tokenCache.expiresAtMs > Date.now() + 30_000) {
    return tokenCache.token;
  }
  return login(baseUrl);
}

function enforceProductsRateLimit() {
  const minIntervalMs = Math.max(SUPPLIER_TRM_SYNC_MIN_INTERVAL_SEC, 60) * 1000;
  const now = Date.now();
  const elapsed = now - lastProductsFetchAtMs;
  if (lastProductsFetchAtMs > 0 && elapsed < minIntervalMs) {
    const waitSeconds = Math.ceil((minIntervalMs - elapsed) / 1000);
    throw new Error(
      `TRM /v1/products_full_list_new rate limit hit. Retry in ${waitSeconds}s (min interval ${Math.ceil(
        minIntervalMs / 1000
      )}s).`
    );
  }
}

export function createTrmSupplierClient() {
  const baseUrl = normalizeBaseUrl(SUPPLIER_TRM_BASE_URL);
  return {
    async fetchProductsFullList(): Promise<TrmProduct[]> {
      enforceProductsRateLimit();
      const token = await getAccessToken(baseUrl);
      const response = await fetch(`${baseUrl}/v1/products_full_list_new`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      lastProductsFetchAtMs = Date.now();
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`TRM products fetch failed (${response.status}): ${text}`);
      }
      const payload = await response.json();
      return parseProducts(payload);
    },
    async fetchProductBySku(sku: string): Promise<TrmProduct | null> {
      const token = await getAccessToken(baseUrl);
      const response = await fetch(`${baseUrl}/v1/product/${encodeURIComponent(sku)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`TRM product fetch failed (${response.status}): ${text}`);
      }
      const payload = await response.json();
      return parseProduct(payload);
    },
  };
}

