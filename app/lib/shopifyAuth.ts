const SHOP_NAME = process.env.SHOP_NAME_SHOPIFY;
const SHOP_DOMAIN_ALIAS = process.env.SHOPIFY_SHOP_DOMAIN;
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES;
const SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL;
const SHOPIFY_MYSHOPIFY_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

type AuthRedirect = {
  state: string;
  url: string;
};

type BuildAuthRedirectOptions = {
  shop?: string | null;
};

const ensureCrypto = () => {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Edge runtime requires crypto.getRandomValues");
  }
};

const normalizeShopDomain = (value: string): string => {
  const trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed) {
    throw new Error("Missing Shopify shop domain");
  }
  const noProtocol = trimmed.replace(/^https?:\/\//, "");
  const normalized = noProtocol.split("/")[0];
  if (!SHOPIFY_MYSHOPIFY_DOMAIN_RE.test(normalized)) {
    throw new Error("Invalid Shopify shop domain");
  }
  return normalized;
};

const resolveConfiguredShopDomain = (): string => {
  const configured = SHOP_NAME || SHOP_DOMAIN_ALIAS;
  if (!configured) {
    throw new Error("Missing Shopify shop domain (SHOP_NAME_SHOPIFY or SHOPIFY_SHOP_DOMAIN)");
  }
  return normalizeShopDomain(configured);
};

const resolveAppBaseUrl = (): string => {
  const value = String(SHOPIFY_APP_URL || "").trim();
  if (!value) {
    throw new Error("Missing SHOPIFY_APP_URL");
  }
  if (!/^https?:\/\//i.test(value)) {
    throw new Error("SHOPIFY_APP_URL must include protocol (https://...)");
  }
  return value.replace(/\/$/, "");
};

const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
};

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const serializeSearchParamsForHmac = (searchParams: URLSearchParams): string => {
  const pairs = Array.from(searchParams.entries())
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([aKey, aValue], [bKey, bValue]) => {
      if (aKey === bKey) return aValue.localeCompare(bValue);
      return aKey.localeCompare(bKey);
    });
  return pairs.map(([key, value]) => `${key}=${value}`).join("&");
};

export function resolveShopDomain(requestedShop?: string | null): string {
  const configuredRaw = SHOP_NAME || SHOP_DOMAIN_ALIAS;
  const configuredShop = configuredRaw ? normalizeShopDomain(configuredRaw) : "";

  if (requestedShop && String(requestedShop).trim()) {
    const requested = normalizeShopDomain(requestedShop);
    if (configuredShop && requested !== configuredShop) {
      throw new Error("Shop domain does not match configured Shopify shop");
    }
    return requested;
  }
  if (configuredShop) {
    return configuredShop;
  }
  return resolveConfiguredShopDomain();
}

export function buildAuthRedirect(options: BuildAuthRedirectOptions = {}): AuthRedirect {
  if (!SHOPIFY_API_KEY || !SHOPIFY_SCOPES || !SHOPIFY_APP_URL) {
    throw new Error("Missing Shopify OAuth configuration");
  }

  const shopDomain = resolveShopDomain(options.shop);
  const appBaseUrl = resolveAppBaseUrl();
  ensureCrypto();
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  const state = Array.from(randomBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const redirectUri = `${appBaseUrl}/auth/callback`;
  const url =
    `https://${shopDomain}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=${encodeURIComponent(SHOPIFY_SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  return { state, url };
}

export async function verifyCallbackHmac(searchParams: URLSearchParams): Promise<boolean> {
  if (!SHOPIFY_API_SECRET) {
    throw new Error("Missing Shopify app secret");
  }

  const providedHmac = String(searchParams.get("hmac") || "").trim().toLowerCase();
  if (!providedHmac) {
    return false;
  }

  const payload = serializeSearchParamsForHmac(searchParams);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SHOPIFY_API_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expectedHmac = toHex(digest);
  return timingSafeEqual(expectedHmac, providedHmac);
}

export async function exchangeAuthCode(shop: string, code: string) {
  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    throw new Error("Missing Shopify app credentials");
  }

  const normalizedShop = resolveShopDomain(shop);
  const tokenRes = await fetch(`https://${normalizedShop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  const payload = await tokenRes.json();
  return payload?.access_token;
}

