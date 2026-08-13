import { createHash } from "node:crypto";

import { getAccessTokenForOAuth } from "@/adsanalytics/google/oauth";
import { backoffDelayMs } from "@/adsanalytics/google/adsClient";
import { resolveMerchantOauthConfig } from "@/adsanalytics/config";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MERCHANT_HTTP_TIMEOUT_MS = 45_000;

export type MerchantApiBackend = "merchantapi_v1beta";

export type MerchantSource = {
  id: string;
  name: string;
  backend: MerchantApiBackend;
  primaryGuess: boolean;
  explorerGuess: boolean;
  raw: Record<string, unknown>;
};

export type MerchantProductRef = {
  offerId: string;
  contentLanguage: string;
  feedLabel: string;
};

export class MerchantApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Merchant API error (HTTP ${status}): ${body.slice(0, 600)}`);
    this.name = "MerchantApiError";
    this.status = status;
    this.body = body;
  }
}

async function requestJson(
  url: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body: unknown = null,
  maxAttempts = 5,
  tokenOverride?: string
): Promise<Record<string, unknown>> {
  const oauth = resolveMerchantOauthConfig();
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const token = tokenOverride ?? (await getAccessTokenForOAuth(oauth));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), MERCHANT_HTTP_TIMEOUT_MS);
    let res: Response;
    let text = "";
    try {
      res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: body == null ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
      text = await res.text();
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === "AbortError";
      if ((isAbort || attempt < maxAttempts) && attempt < maxAttempts) {
        lastErr = isAbort ? new Error(`Merchant API timeout after ${MERCHANT_HTTP_TIMEOUT_MS}ms`) : err;
        await new Promise((resolve) => setTimeout(resolve, backoffDelayMs(attempt)));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      try {
        return text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        return { rawText: text };
      }
    }
    if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
      lastErr = new MerchantApiError(res.status, text);
      await new Promise((resolve) => setTimeout(resolve, backoffDelayMs(attempt)));
      continue;
    }
    throw new MerchantApiError(res.status, text);
  }
  throw lastErr instanceof Error ? lastErr : new Error("Merchant API failed");
}

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function extractNameFromSource(raw: Record<string, unknown>): string {
  const direct =
    asString(raw.displayName) ||
    asString(raw.name) ||
    asString(raw.dataSourceId) ||
    asString(raw.id);
  return direct || "(unnamed)";
}

function classifySource(raw: Record<string, unknown>): {
  primaryGuess: boolean;
  explorerGuess: boolean;
} {
  const joined = JSON.stringify(raw).toLowerCase();
  const primaryGuess =
    joined.includes("primary") ||
    joined.includes("simprosys") ||
    joined.includes("contentapi") ||
    joined.includes("main feed") ||
    joined.includes("product feed");
  const explorerGuess =
    joined.includes("explorer") || joined.includes("customlabel3") || joined.includes("long tail");
  return { primaryGuess, explorerGuess };
}

export async function merchantAuthCheck(merchantId: string): Promise<{
  merchantRefreshTokenPresent: boolean;
  merchantRefreshTokenLength: number;
  merchantRefreshTokenFingerprint8: string | null;
  accessTokenObtained: boolean;
  tokenScopes: string[];
  contentScopePresent: boolean;
  merchantAccountAccessible: boolean;
  merchantIdReturned: string | null;
  googleIdentity: string | null;
  errorCode: string | null;
}> {
  const oauth = resolveMerchantOauthConfig();
  const merchantTokenRaw = (process.env.GOOGLE_MERCHANT_REFRESH_TOKEN ?? "").trim();
  const merchantRefreshTokenPresent = merchantTokenRaw.length > 0;
  const merchantRefreshTokenLength = merchantTokenRaw.length;
  const merchantRefreshTokenFingerprint8 = merchantRefreshTokenPresent
    ? createHash("sha256").update(merchantTokenRaw).digest("hex").slice(0, 8)
    : null;
  let token = "";
  let accessTokenObtained = false;
  let tokenScopes: string[] = [];
  let contentScopePresent = false;
  let merchantAccountAccessible = false;
  let merchantIdReturned: string | null = null;
  let googleIdentity: string | null = null;
  let errorCode: string | null = null;
  try {
    token = await getAccessTokenForOAuth(oauth);
    accessTokenObtained = true;
  } catch {
    return {
      merchantRefreshTokenPresent,
      merchantRefreshTokenLength,
      merchantRefreshTokenFingerprint8,
      accessTokenObtained: false,
      tokenScopes: [],
      contentScopePresent: false,
      merchantAccountAccessible: false,
      merchantIdReturned: null,
      googleIdentity: null,
      errorCode: "token_obtain_failed",
    };
  }

  try {
    const tokenInfo = await requestJson(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`,
      "GET",
      null,
      1,
      token
    );
    const scopeRaw = asString(tokenInfo.scope);
    tokenScopes = scopeRaw
      .split(" ")
      .map((s) => s.trim())
      .filter(Boolean);
    const scopeRawLc = scopeRaw.toLowerCase();
    contentScopePresent =
      scopeRawLc.includes("https://www.googleapis.com/auth/content") ||
      tokenScopes.includes("https://www.googleapis.com/auth/content");
    googleIdentity =
      asString(tokenInfo.email) ||
      asString(tokenInfo.sub) ||
      asString(tokenInfo.user_id) ||
      null;
  } catch {
    errorCode = "scope_check_failed";
  }

  try {
    const account = await requestJson(
      `https://merchantapi.googleapis.com/accounts/v1beta/accounts/${merchantId}`,
      "GET",
      null,
      2,
      token
    );
    merchantAccountAccessible = true;
    merchantIdReturned =
      asString(account.accountId) ||
      asString(account.account) ||
      asString(account.name).split("/").pop() ||
      merchantId;
  } catch (err) {
    try {
      const ds = await requestJson(
        `https://merchantapi.googleapis.com/datasources/v1/accounts/${merchantId}/dataSources?pageSize=1`,
        "GET",
        null,
        1,
        token
      );
      const list = Array.isArray(ds.dataSources) ? ds.dataSources : [];
      merchantAccountAccessible = true;
      merchantIdReturned = merchantId;
      if (list.length > 0) errorCode = null;
    } catch {
      merchantAccountAccessible = false;
      if (!errorCode) {
        if (err instanceof MerchantApiError) errorCode = `merchant_http_${err.status}`;
        else errorCode = "merchant_access_failed";
      }
    }
  }

  return {
    merchantRefreshTokenPresent,
    merchantRefreshTokenLength,
    merchantRefreshTokenFingerprint8,
    accessTokenObtained,
    tokenScopes,
    contentScopePresent,
    merchantAccountAccessible,
    merchantIdReturned,
    googleIdentity,
    errorCode,
  };
}

export async function listMerchantSources(
  merchantId: string
): Promise<{
  backend: MerchantApiBackend;
  sources: MerchantSource[];
  rawResponse: Record<string, unknown>;
}> {
  let raw: Record<string, unknown>;
  try {
    raw = await requestJson(
      `https://merchantapi.googleapis.com/datasources/v1/accounts/${merchantId}/dataSources?pageSize=250`,
      "GET"
    );
  } catch (err) {
    if (!(err instanceof MerchantApiError) || err.status !== 404) throw err;
    raw = await requestJson(
      `https://merchantapi.googleapis.com/datasources/v1beta/accounts/${merchantId}/dataSources?pageSize=250`,
      "GET"
    );
  }
  const list = ((raw.dataSources as unknown[]) ?? []) as Record<string, unknown>[];
  const sources = list.map((src) => {
    const id = asString(src.name) || asString(src.dataSourceId) || asString(src.id);
    const name = extractNameFromSource(src);
    const { primaryGuess, explorerGuess } = classifySource(src);
    return { id, name, backend: "merchantapi_v1beta" as const, primaryGuess, explorerGuess, raw: src };
  });
  return { backend: "merchantapi_v1beta", sources, rawResponse: raw };
}

export function sourcePlanHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

export async function registerMerchantDeveloperGcp(
  merchantId: string,
  developerEmail: string
): Promise<Record<string, unknown>> {
  const name = `accounts/${merchantId}/developerRegistration`;
  return requestJson(
    `https://merchantapi.googleapis.com/accounts/v1/${name}:registerGcp`,
    "POST",
    { developerEmail },
    2
  );
}

function encodeProductKey(ref: MerchantProductRef): string {
  const raw = `${ref.contentLanguage}~${ref.feedLabel}~${ref.offerId}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

export async function createSupplementalApiDataSource(
  merchantId: string,
  displayName: string
): Promise<Record<string, unknown>> {
  return requestJson(
    `https://merchantapi.googleapis.com/datasources/v1/accounts/${merchantId}/dataSources`,
    "POST",
    {
      displayName,
      supplementalProductDataSource: {},
    },
    2
  );
}

export async function patchPrimaryDataSourceDefaultRule(
  primaryDataSourceName: string,
  takeFromDataSources: Array<Record<string, unknown>>
): Promise<Record<string, unknown>> {
  const encodedName = primaryDataSourceName
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return requestJson(
    `https://merchantapi.googleapis.com/datasources/v1/${encodedName}?updateMask=primaryProductDataSource.defaultRule`,
    "PATCH",
    {
      name: primaryDataSourceName,
      primaryProductDataSource: {
        defaultRule: {
          takeFromDataSources,
        },
      },
    },
    2
  );
}

export async function insertSupplementalProductLabel(
  merchantId: string,
  dataSource: string,
  product: MerchantProductRef,
  customLabel3: string
): Promise<Record<string, unknown>> {
  const q = encodeURIComponent(dataSource);
  return requestJson(
    `https://merchantapi.googleapis.com/products/v1/accounts/${merchantId}/productInputs:insert?dataSource=${q}`,
    "POST",
    {
      offerId: product.offerId,
      contentLanguage: product.contentLanguage,
      feedLabel: product.feedLabel,
      productAttributes: { customLabel3 },
    },
    3
  );
}

export async function deleteSupplementalProductInput(
  merchantId: string,
  dataSource: string,
  product: MerchantProductRef
): Promise<Record<string, unknown>> {
  const q = encodeURIComponent(dataSource);
  const encoded = encodeProductKey(product);
  return requestJson(
    `https://merchantapi.googleapis.com/products/v1/accounts/${merchantId}/productInputs/${encoded}?dataSource=${q}`,
    "DELETE",
    null,
    3
  );
}

export async function getProcessedProduct(
  merchantId: string,
  product: MerchantProductRef
): Promise<Record<string, unknown>> {
  const encoded = encodeProductKey(product);
  return requestJson(
    `https://merchantapi.googleapis.com/products/v1/accounts/${merchantId}/products/${encoded}`,
    "GET",
    null,
    2
  );
}

export async function getProductInput(
  merchantId: string,
  dataSource: string,
  product: MerchantProductRef
): Promise<Record<string, unknown> | null> {
  const encoded = encodeProductKey(product);
  const qs = `dataSource=${encodeURIComponent(dataSource)}`;
  const base = `https://merchantapi.googleapis.com/products/v1/accounts/${merchantId}/productInputs/${encoded}`;
  try {
    return await requestJson(`${base}?${qs}`, "GET", null, 2);
  } catch (err) {
    if (err instanceof MerchantApiError && err.status === 404) return null;
    // Fallback for potential API behavior differences.
    try {
      return await requestJson(base, "GET", null, 1);
    } catch (fallbackErr) {
      if (fallbackErr instanceof MerchantApiError && fallbackErr.status === 404) return null;
      throw fallbackErr;
    }
  }
}

export function extractCustomLabel3(product: Record<string, unknown>): string | null {
  const attrs = (product.productAttributes ?? product.attributes) as Record<string, unknown> | undefined;
  if (attrs) {
    const direct = asString((attrs as Record<string, unknown>).customLabel3);
    if (direct) return direct;
    const snake = asString((attrs as Record<string, unknown>).custom_label_3);
    if (snake) return snake;
  }
  const customs = Array.isArray(product.customAttributes) ? product.customAttributes : [];
  for (const entry of customs) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const name = asString(row.name).trim().toLowerCase();
    if (name === "custom label 3" || name === "custom_label_3" || name === "customlabel3") {
      const value = asString(row.value);
      if (value) return value;
    }
  }
  return null;
}

