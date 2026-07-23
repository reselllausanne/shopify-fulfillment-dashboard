import { findVariantBySku, searchProductVariants } from "@/shopify/catalog/graphql";
import { resolveProductIdentifier } from "@/shopify/restock/createProductFullFlow";

export type ShopifyVariantChoice = {
  variantId: string;
  title: string | null;
  sku: string | null;
  barcode: string | null;
  price: string | null;
  inventoryItemId: string | null;
};

/** Strip duplicate "EU" prefix for UI ("EU 39.5" not "EU EU 39.5"). */
export function formatSizeEuLabel(sizeEu: string | null | undefined): string {
  const raw = String(sizeEu ?? "").trim();
  if (!raw) return "?";
  return raw.replace(/^eu\s+/i, "").trim() || raw;
}

const INVALID_SIZE_LABELS = new Set(["?", "-", "n/a", "na", "unknown", "null", "undefined"]);

/** Real EU size label safe for Shopify variant create (rejects "?" placeholders). */
export function isValidEuSizeForCreate(size: string | null | undefined): boolean {
  const raw = String(size ?? "").trim();
  if (!raw || INVALID_SIZE_LABELS.has(raw.toLowerCase())) return false;
  if (/\d/.test(raw)) return true;
  return /^(xxs|xs|s|m|l|xl|xxl|xxxl|os|one size|o\/s)$/i.test(raw);
}

export function sanitizeEuSizeForCreate(size: string | null | undefined): string | null {
  const label = formatSizeEuLabel(size);
  if (!isValidEuSizeForCreate(label)) return null;
  return label;
}

const UNICODE_FRACTIONS: Record<string, string> = {
  "½": "1/2",
  "⅓": "1/3",
  "⅔": "2/3",
  "¼": "1/4",
  "¾": "3/4",
};

/** Parse EU/US size labels ("39 1/2", "39.5", "39½") to a numeric key for matching. */
export function parseSizeToNumber(value: string | null | undefined): number | null {
  let s = String(value ?? "")
    .toLowerCase()
    .replace(/^eu\s+/i, "")
    .replace(/\s*eu\s*$/i, "")
    .replace(/,/g, ".")
    .replace(/[wy]$/i, "")
    .trim();
  if (!s) return null;

  for (const [symbol, fraction] of Object.entries(UNICODE_FRACTIONS)) {
    s = s.replace(new RegExp(symbol, "g"), ` ${fraction}`);
  }
  s = s.replace(/\s+/g, " ").trim();

  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);

  const frac = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (frac) {
    const whole = parseInt(frac[1]!, 10);
    const num = parseInt(frac[2]!, 10);
    const den = parseInt(frac[3]!, 10);
    if (den > 0) return whole + num / den;
  }

  const embedded = s.match(/(\d+)\s+(\d+)\/(\d+)/);
  if (embedded) {
    const whole = parseInt(embedded[1]!, 10);
    const num = parseInt(embedded[2]!, 10);
    const den = parseInt(embedded[3]!, 10);
    if (den > 0) return whole + num / den;
  }

  const decimal = s.match(/^(\d+\.\d+)/);
  if (decimal) return parseFloat(decimal[1]!);

  return null;
}

export function normalizeSizeTitle(value: string | null | undefined): string {
  const raw = String(value ?? "")
    .toLowerCase()
    .replace(/^eu\s+/i, "")
    .replace(/\s*eu\s*$/i, "")
    .replace(/,/g, ".")
    .replace(/[wy]$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const num = parseSizeToNumber(raw);
  if (num != null && Number.isFinite(num)) {
    const rounded = Math.round(num * 100) / 100;
    return String(rounded);
  }
  return raw;
}

export function sizeTitlesMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = parseSizeToNumber(a);
  const nb = parseSizeToNumber(b);
  if (na != null && nb != null) return Math.abs(na - nb) < 0.05;

  const sa = normalizeSizeTitle(a);
  const sb = normalizeSizeTitle(b);
  if (!sa || !sb) return false;
  return sa === sb || sa.includes(sb) || sb.includes(sa);
}

function skuTailSize(sku: string | null | undefined): string {
  const s = String(sku ?? "").trim();
  if (!s.includes("-")) return "";
  return normalizeSizeTitle(s.split("-").pop() ?? "");
}

/** Pick Shopify variant for scanned physical size (EU preferred, US fallback). */
export function pickVariantBySize(
  variants: ShopifyVariantChoice[],
  sizeEu: string | null | undefined,
  sizeUs: string | null | undefined
): ShopifyVariantChoice | null {
  if (!variants.length) return null;
  const wantedEu = sizeEu ? normalizeSizeTitle(sizeEu) : null;
  const wantedUs = sizeUs ? normalizeSizeTitle(sizeUs) : null;

  const score = (v: ShopifyVariantChoice): number => {
    const title = normalizeSizeTitle(v.title);
    const tail = skuTailSize(v.sku);
    let s = 0;
    if (sizeEu && wantedEu) {
      if (sizeTitlesMatch(v.title, sizeEu) || sizeTitlesMatch(tail, sizeEu)) s += 100;
      else if (parseSizeToNumber(sizeEu) == null && parseSizeToNumber(v.title) == null) {
        if (title.includes(wantedEu) || wantedEu.includes(title)) s += 40;
      }
    }
    if (sizeUs && wantedUs) {
      if (sizeTitlesMatch(v.title, sizeUs)) s += 80;
      else if (parseSizeToNumber(sizeUs) == null && title.includes(wantedUs)) s += 40;
    }
    return s;
  };

  let best: ShopifyVariantChoice | null = null;
  let bestScore = 0;
  for (const v of variants) {
    const sc = score(v);
    if (sc > bestScore) {
      bestScore = sc;
      best = v;
    }
  }
  return bestScore >= 80 ? best : null;
}

function pickProductIdFromResolveRaw(raw: unknown): string | null {
  const r = raw as Record<string, unknown> | null | undefined;
  const product = r?.shopify_product as Record<string, unknown> | undefined;
  const id = product?.id ?? product?.admin_graphql_api_id;
  return typeof id === "string" && id.includes("Product") ? id : null;
}

/** GraphQL fallback: any variant SKU starting with style SKU (U204LMMA-39.5). */
export async function findShopifyProductIdByStyleSku(styleSku: string): Promise<string | null> {
  const sku = String(styleSku ?? "").trim();
  if (!sku) return null;
  const escaped = sku.replace(/"/g, '\\"');
  const rows = await searchProductVariants(`sku:${escaped}*`, 25);
  if (rows.length) return rows[0]!.productId;
  const exact = await findVariantBySku(sku);
  return exact?.productId ?? null;
}

/**
 * Product exists on Shopify for this catalog hit (slug / style SKU) but scanned
 * GTIN may be missing on the variant barcode.
 */
export async function findExistingShopifyProductForCatalogIdentifier(input: {
  slug?: string | null;
  styleSku?: string | null;
}): Promise<{ productId: string; matchedVia: string } | null> {
  const candidates = [input.styleSku, input.slug].map((s) => String(s ?? "").trim()).filter(Boolean);
  const seen = new Set<string>();

  for (const identifier of candidates) {
    if (seen.has(identifier)) continue;
    seen.add(identifier);

    try {
      const resolved = await resolveProductIdentifier(identifier);
      if (resolved.onShopify) {
        const productId = pickProductIdFromResolveRaw(resolved.raw);
        if (productId) {
          return { productId, matchedVia: `resolve:${identifier}` };
        }
      }
    } catch {
      // Non-fatal — try GraphQL fallback.
    }

    if (input.styleSku && identifier === input.styleSku) {
      const productId = await findShopifyProductIdByStyleSku(input.styleSku);
      if (productId) {
        return { productId, matchedVia: `graphql_sku:${input.styleSku}` };
      }
    }
  }

  return null;
}
