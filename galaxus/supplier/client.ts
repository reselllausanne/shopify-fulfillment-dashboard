import {
  GOLDEN_SUPPLIER_API_BASE_URL,
  GOLDEN_SUPPLIER_API_KEY,
  GOLDEN_SUPPLIER_API_KEY_HEADER,
  GOLDEN_SUPPLIER_API_KEY_PREFIX,
} from "../config";
import type {
  GoldenFlatSize,
  SupplierAuthConfig,
  SupplierCatalogItem,
  SupplierClient,
  SupplierDropshipOrderRequest,
  SupplierDropshipOrderResponse,
  SupplierDropshipOrderDetails,
} from "./types";

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

async function postJson<T>(url: string, auth: SupplierAuthConfig, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(auth),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Golden supplier request failed (${response.status}): ${text}`);
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

type GoldenDropshipCreateResponse = {
  message?: string;
  order_id: number;
  total_price?: number | null;
  dropship_package_id?: number | null;
};

type GoldenDropshipDetailsResponse = {
  order_id: number;
  status: string;
  total_amount?: number | null;
  currency?: string | null;
  created_at?: string | null;
  dropship_package_id?: number | null;
  tracking_numbers?: string[];
  items?: unknown[];
};

async function createDropshipOrder(
  auth: SupplierAuthConfig,
  request: SupplierDropshipOrderRequest
): Promise<SupplierDropshipOrderResponse> {
  const url = `${auth.baseUrl}/orders-dropship/create-order/`;
  const payload = {
    delivery_address: {
      name: request.deliveryAddress.name,
      city: request.deliveryAddress.city,
      zip_code: request.deliveryAddress.zipCode,
      street: request.deliveryAddress.street,
      country_code: request.deliveryAddress.countryCode,
      phone: request.deliveryAddress.phone,
      email: request.deliveryAddress.email,
    },
    client_provides_shipping_label: request.clientProvidesShippingLabel ?? false,
    items: request.items.map((item) => ({
      size_id: item.sizeId,
      sku: item.sku,
      size_us: item.sizeUs,
      quantity: item.quantity,
    })),
  };
  const response = await postJson<GoldenDropshipCreateResponse>(url, auth, payload);
  return {
    orderId: String(response.order_id),
    totalPrice: response.total_price ?? null,
    dropshipPackageId:
      response.dropship_package_id !== null && response.dropship_package_id !== undefined
        ? String(response.dropship_package_id)
        : null,
    raw: response,
  };
}

async function getDropshipOrderDetails(
  auth: SupplierAuthConfig,
  orderId: string
): Promise<SupplierDropshipOrderDetails> {
  const url = `${auth.baseUrl}/orders-dropship/order-details/${orderId}/`;
  const response = await fetchJson<GoldenDropshipDetailsResponse>(url, auth);
  return {
    orderId: String(response.order_id),
    status: response.status,
    totalAmount: response.total_amount ?? null,
    currency: response.currency ?? null,
    createdAt: response.created_at ?? null,
    dropshipPackageId:
      response.dropship_package_id !== null && response.dropship_package_id !== undefined
        ? String(response.dropship_package_id)
        : null,
    trackingNumbers: response.tracking_numbers ?? [],
    raw: response,
  };
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
    async createDropshipOrder(request) {
      return createDropshipOrder(auth, request);
    },
    async getDropshipOrderDetails(orderId: string) {
      return getDropshipOrderDetails(auth, orderId);
    },
  };
}
