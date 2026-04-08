import {
  DECATHLON_MIRAKL_API_BASE_URL,
  DECATHLON_MIRAKL_API_KEY,
  DECATHLON_MIRAKL_API_KEY_HEADER,
  DECATHLON_MIRAKL_API_KEY_PREFIX,
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

function buildHeaders(auth: MiraklAuthConfig, extra?: Record<string, string>): HeadersInit {
  const key = String(auth.apiKey ?? "").trim();
  if (!key) {
    throw new Error("Missing DECATHLON_MIRAKL_API_KEY");
  }
  return {
    [auth.apiKeyHeader]: `${auth.apiKeyPrefix}${key}`,
    ...(extra ?? {}),
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

async function fetchJson<T>(url: string, auth: MiraklAuthConfig, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: buildHeaders(auth, { accept: "application/json", ...(init?.headers as Record<string, string>) }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Mirakl request failed (${response.status}): ${body}`);
  }
  if (!body || !body.trim()) {
    return {} as T;
  }
  try {
    return JSON.parse(body) as T;
  } catch (error) {
    throw new Error(`Mirakl response not JSON (${response.status}): ${body}`);
  }
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

async function putJson<T>(url: string, auth: MiraklAuthConfig, payload: unknown): Promise<T> {
  return fetchJson<T>(url, auth, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
}

export function buildDecathlonOrdersClient() {
  const auth = buildAuthConfig();
  if (!auth.baseUrl) {
    throw new Error("Missing DECATHLON_MIRAKL_API_BASE_URL");
  }
  return {
    listOrders: (params?: Record<string, string | number | boolean>) =>
      fetchJson(buildUrl(auth.baseUrl, "/api/orders", params), auth),
    getOrder: (orderId: string) => fetchJson(buildUrl(auth.baseUrl, `/api/orders/${orderId}`), auth),
    listCarriers: () => fetchJson(buildUrl(auth.baseUrl, "/api/shipping/carriers"), auth),
    acceptOrder: (orderId: string, payload: unknown) =>
      putJson(buildUrl(auth.baseUrl, `/api/orders/${orderId}/accept`), auth, payload),
    setTracking: (orderId: string, payload: unknown) =>
      putJson(buildUrl(auth.baseUrl, `/api/orders/${orderId}/tracking`), auth, payload),
    shipOrder: (orderId: string, payload: unknown = {}) =>
      putJson(buildUrl(auth.baseUrl, `/api/orders/${orderId}/ship`), auth, payload),
    listDocuments: (params?: Record<string, string | number | boolean>) =>
      fetchJson(buildUrl(auth.baseUrl, "/api/orders/documents", params), auth),
    downloadDocuments: (params?: Record<string, string | number | boolean>) =>
      fetchBinary(buildUrl(auth.baseUrl, "/api/orders/documents/download", params), auth),
  };
}
