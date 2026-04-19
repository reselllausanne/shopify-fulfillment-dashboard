import {
  DECATHLON_MIRAKL_API_BASE_URL,
  DECATHLON_MIRAKL_API_KEY,
  DECATHLON_MIRAKL_API_KEY_HEADER,
  DECATHLON_MIRAKL_API_KEY_PREFIX,
  DECATHLON_MIRAKL_ERROR_SUFFIX,
  DECATHLON_MIRAKL_MCM_STATUS_EXPORT_PATH,
  DECATHLON_MIRAKL_OFFERS_IMPORT_PATH,
  DECATHLON_MIRAKL_OFFERS_STATUS_PATH,
  DECATHLON_MIRAKL_PRODUCTS_ATTRS_PATH,
  DECATHLON_MIRAKL_PRODUCTS_IMPORT_PATH,
  DECATHLON_MIRAKL_PRODUCTS_STATUS_PATH,
  DECATHLON_MIRAKL_PRICING_IMPORT_PATH,
  DECATHLON_MIRAKL_PRICING_STATUS_PATH,
  DECATHLON_MIRAKL_STOCK_IMPORT_PATH,
  DECATHLON_MIRAKL_STOCK_STATUS_PATH,
} from "./config";

type MiraklAuthConfig = {
  baseUrl: string;
  apiKey: string;
  apiKeyHeader: string;
  apiKeyPrefix: string;
};

function buildAuthConfig(): MiraklAuthConfig {
  return {
    baseUrl: DECATHLON_MIRAKL_API_BASE_URL.replace(/\/$/, ""),
    apiKey: DECATHLON_MIRAKL_API_KEY,
    apiKeyHeader: DECATHLON_MIRAKL_API_KEY_HEADER,
    apiKeyPrefix: DECATHLON_MIRAKL_API_KEY_PREFIX,
  };
}

function buildHeaders(auth: MiraklAuthConfig): HeadersInit {
  const key = String(auth.apiKey ?? "").trim();
  if (!key) {
    throw new Error("Missing DECATHLON_MIRAKL_API_KEY");
  }
  return {
    [auth.apiKeyHeader]: `${auth.apiKeyPrefix}${key}`,
  };
}

function buildUrl(baseUrl: string, path: string, params?: Record<string, string | number | boolean>) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalized}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function fetchJson<T>(url: string, auth: MiraklAuthConfig): Promise<T> {
  const response = await fetch(url, { headers: buildHeaders(auth) });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Mirakl request failed (${response.status}): ${body}`);
  }
  return response.json() as Promise<T>;
}

async function fetchText(url: string, auth: MiraklAuthConfig): Promise<string> {
  const response = await fetch(url, { headers: buildHeaders(auth) });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Mirakl request failed (${response.status}): ${body}`);
  }
  return response.text();
}

async function fetchBinary(url: string, auth: MiraklAuthConfig): Promise<{ buffer: Buffer; contentType: string | null }> {
  const response = await fetch(url, { headers: buildHeaders(auth) });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Mirakl request failed (${response.status}): ${body}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType: response.headers.get("content-type") };
}

async function postCsv(
  url: string,
  auth: MiraklAuthConfig,
  csv: string,
  filename: string,
  formFields?: Record<string, string | number | boolean>
): Promise<any> {
  const form = new FormData();
  const blob = new Blob([csv], { type: "text/csv" });
  form.append("file", blob, filename);
  if (formFields) {
    for (const [key, value] of Object.entries(formFields)) {
      form.append(key, String(value));
    }
  }
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(auth),
    body: form,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Mirakl import failed (${response.status}): ${body}`);
  }
  return response.json().catch(() => ({}));
}

export function buildMiraklClient() {
  const auth = buildAuthConfig();
  if (!auth.baseUrl) {
    throw new Error("Missing DECATHLON_MIRAKL_API_BASE_URL");
  }

  return {
    importOffers: (csv: string, params?: Record<string, string | number | boolean>) =>
      postCsv(buildUrl(auth.baseUrl, DECATHLON_MIRAKL_OFFERS_IMPORT_PATH, params), auth, csv, "offers.csv"),
    importStock: (csv: string, params?: Record<string, string | number | boolean>) =>
      postCsv(buildUrl(auth.baseUrl, DECATHLON_MIRAKL_STOCK_IMPORT_PATH, params), auth, csv, "stock.csv"),
    importPricing: (csv: string, params?: Record<string, string | number | boolean>) =>
      postCsv(buildUrl(auth.baseUrl, DECATHLON_MIRAKL_PRICING_IMPORT_PATH, params), auth, csv, "pricing.csv"),
    importProducts: (
      csv: string,
      params?: Record<string, string | number | boolean>,
      formFields?: Record<string, string | number | boolean>
    ) =>
      postCsv(
        buildUrl(auth.baseUrl, DECATHLON_MIRAKL_PRODUCTS_IMPORT_PATH, params),
        auth,
        csv,
        "products.csv",
        formFields
      ),
    getOfferImportStatus: (importId: string) =>
      fetchJson(buildUrl(auth.baseUrl, `${DECATHLON_MIRAKL_OFFERS_STATUS_PATH}/${importId}`), auth),
    getStockImportStatus: (importId: string) =>
      fetchJson(buildUrl(auth.baseUrl, `${DECATHLON_MIRAKL_STOCK_STATUS_PATH}/${importId}`), auth),
    getPricingImportStatus: (importId: string) =>
      fetchJson(buildUrl(auth.baseUrl, `${DECATHLON_MIRAKL_PRICING_STATUS_PATH}/${importId}`), auth),
    /** P51 — GET product import status (same path family as POST P41). */
    getProductImportStatus: (importId: string) =>
      fetchJson(buildUrl(auth.baseUrl, `${DECATHLON_MIRAKL_PRODUCTS_STATUS_PATH}/${importId}`), auth),
    getProductStatusExport: () => fetchText(buildUrl(auth.baseUrl, DECATHLON_MIRAKL_MCM_STATUS_EXPORT_PATH), auth),
    getProductAttributes: (hierarchy: string) =>
      fetchJson(
        buildUrl(auth.baseUrl, DECATHLON_MIRAKL_PRODUCTS_ATTRS_PATH, {
          hierarchy,
          all_operator_attributes: true,
        }),
        auth
      ),
    downloadOfferErrorReport: (importId: string) =>
      fetchBinary(
        buildUrl(auth.baseUrl, `${DECATHLON_MIRAKL_OFFERS_STATUS_PATH}/${importId}${DECATHLON_MIRAKL_ERROR_SUFFIX}`),
        auth
      ),
    downloadStockErrorReport: (importId: string) =>
      fetchBinary(
        buildUrl(auth.baseUrl, `${DECATHLON_MIRAKL_STOCK_STATUS_PATH}/${importId}${DECATHLON_MIRAKL_ERROR_SUFFIX}`),
        auth
      ),
    downloadPricingErrorReport: (importId: string) =>
      fetchBinary(
        buildUrl(auth.baseUrl, `${DECATHLON_MIRAKL_PRICING_STATUS_PATH}/${importId}${DECATHLON_MIRAKL_ERROR_SUFFIX}`),
        auth
      ),
    downloadProductErrorReport: (importId: string) =>
      fetchBinary(
        buildUrl(auth.baseUrl, `${DECATHLON_MIRAKL_PRODUCTS_STATUS_PATH}/${importId}${DECATHLON_MIRAKL_ERROR_SUFFIX}`),
        auth
      ),
  };
}
