const DEFAULT_SHOPIFY_API_VERSION = "2026-01";

const SHOP_ENV_KEYS = ["SHOP_NAME_SHOPIFY", "SHOPIFY_SHOP_DOMAIN"] as const;
const TOKEN_ENV_KEYS = ["ACCESS_TOKEN_SHOPIFY", "SHOPIFY_ADMIN_ACCESS_TOKEN"] as const;
const VERSION_ENV_KEYS = ["API_VERSION_SHOPIFY", "SHOPIFY_API_VERSION"] as const;

export const REQUIRED_SHOPIFY_ADMIN_SCOPES = [
  "read_orders",
  "read_products",
  "write_products",
  "read_inventory",
  "write_inventory",
  "read_locations",
] as const;

function readFirst(keys: readonly string[], fallback = ""): string {
  for (const key of keys) {
    const raw = process.env[key];
    if (raw === null || raw === undefined) continue;
    const value = String(raw).trim();
    if (value) return value;
  }
  return fallback;
}

export type ShopifyAdminEnv = {
  shop: string;
  token: string;
  version: string;
};

export function resolveShopifyAdminEnv(): ShopifyAdminEnv {
  return {
    shop: readFirst(SHOP_ENV_KEYS),
    token: readFirst(TOKEN_ENV_KEYS),
    version: readFirst(VERSION_ENV_KEYS, DEFAULT_SHOPIFY_API_VERSION),
  };
}

export function missingShopifyAdminEnvKeys(env = resolveShopifyAdminEnv()): string[] {
  const missing: string[] = [];
  if (!env.shop) {
    missing.push(SHOP_ENV_KEYS.join(" or "));
  }
  if (!env.token) {
    missing.push(TOKEN_ENV_KEYS.join(" or "));
  }
  return missing;
}

export function normalizeShopifyScope(scope: string): string {
  return scope.trim().toLowerCase();
}

export function parseShopifyScopes(scopes: string | string[] | null | undefined): Set<string> {
  if (!scopes) return new Set();
  const values = Array.isArray(scopes) ? scopes : scopes.split(",");
  const normalized = values
    .map((value) => normalizeShopifyScope(String(value)))
    .filter(Boolean);
  return new Set(normalized);
}

export function listMissingRequiredScopes(
  availableScopes: Iterable<string>,
  requiredScopes: readonly string[] = REQUIRED_SHOPIFY_ADMIN_SCOPES
): string[] {
  const available = new Set(
    Array.from(availableScopes, (scope) => normalizeShopifyScope(String(scope))).filter(Boolean)
  );
  return requiredScopes.filter((scope) => !available.has(normalizeShopifyScope(scope)));
}
