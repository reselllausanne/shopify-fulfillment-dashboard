/**
 * Shopify products managed only in admin.
 * Automation may mirror inventory qty; never touch price, express, delivery, soldes.
 *
 * Env override:
 *   SHOPIFY_ADMIN_ONLY_PRODUCT_IDS=15340410732930,...
 *   SHOPIFY_ADMIN_ONLY_VARIANT_IDS=56670660067714
 *
 * Includes fixed-price in-stock lane (Essentials / Bape / AP×Travis / Supreme boxers).
 * Python SSE/StockX path mirrors this list in
 * `portable_product_upsert/admin_only_products.py` (hard-skip update).
 */
const HARDCODED_PRODUCT_IDS = new Set([
  // Essentials
  "15340410732930", // Shorts Stretch Limo
  "15340410831234", // Shorts Dark Oatmeal
  "15340410896770", // Shorts Light Oatmeal
  "15340411617666", // Tee Stretch Limo
  "15349630501250", // Tee Light Oatmeal
  "15369534538114", // Tee Dark Oatmeal
  // Audemars × Travis
  "15115016733058", // Vintage Tee Black
  "15115016831362", // Watch Face Tee Green
  // Bape
  "15356478325122", // Check by Bathing Tee
  "15356478357890", // Big Ape Head Tee
  // Supreme Hanes boxers (4-pack) — JMoney retail, never StockX soldes
  "15074846179714", // Black
  "15075733504386", // White
]);

const HARDCODED_VARIANT_IDS = new Set([
  "56670660067714",
]);

export type ShopifyWriteScope =
  | "price"
  | "express"
  | "delivery"
  | "soldes"
  | "priceLock"
  | "productMeta"
  | "variantIdentity"
  | "inventory"
  | "create";

function normalizeShopifyNumericId(id: string | null | undefined): string {
  const raw = String(id ?? "").trim();
  if (!raw) return "";
  const gidMatch = raw.match(/\/(\d+)$/);
  if (gidMatch) return gidMatch[1];
  const digits = raw.replace(/\D/g, "");
  return digits || raw;
}

function loadProductIds(): Set<string> {
  const ids = new Set(HARDCODED_PRODUCT_IDS);
  const env = process.env.SHOPIFY_ADMIN_ONLY_PRODUCT_IDS ?? "";
  for (const part of env.split(",")) {
    const n = normalizeShopifyNumericId(part.trim());
    if (n) ids.add(n);
  }
  return ids;
}

function loadVariantIds(): Set<string> {
  const ids = new Set(HARDCODED_VARIANT_IDS);
  const env = process.env.SHOPIFY_ADMIN_ONLY_VARIANT_IDS ?? "";
  for (const part of env.split(",")) {
    const n = normalizeShopifyNumericId(part.trim());
    if (n) ids.add(n);
  }
  return ids;
}

export function isAdminOnlyShopifyProduct(productId: string | null | undefined): boolean {
  const n = normalizeShopifyNumericId(productId);
  return Boolean(n && loadProductIds().has(n));
}

export function isAdminOnlyShopifyVariant(
  variantId: string | null | undefined,
  productId?: string | null | undefined
): boolean {
  const variantNumeric = normalizeShopifyNumericId(variantId);
  if (variantNumeric && loadVariantIds().has(variantNumeric)) return true;
  return isAdminOnlyShopifyProduct(productId);
}

/** Admin-only products: inventory writes allowed; everything else blocked. */
export function isShopifyWriteBlocked(
  scope: ShopifyWriteScope,
  ids: { variantId?: string | null; productId?: string | null }
): boolean {
  if (!isAdminOnlyShopifyVariant(ids.variantId, ids.productId)) return false;
  return scope !== "inventory";
}

export function adminOnlySkipReason(scope: ShopifyWriteScope): string {
  return `admin_only_product:${scope}`;
}
