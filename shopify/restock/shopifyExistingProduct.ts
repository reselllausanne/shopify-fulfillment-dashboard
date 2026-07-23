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

export function normalizeSizeTitle(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/^eu\s+/i, "")
    .replace(/\s*eu\s*$/i, "")
    .replace(/,/g, ".")
    .replace(/[wy]$/i, "")
    .replace(/\s+/g, " ")
    .trim();
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
    if (wantedEu) {
      if (title === wantedEu || tail === wantedEu) s += 100;
      else if (title.includes(wantedEu) || tail.includes(wantedEu)) s += 50;
      else if (wantedEu.includes(title) && title) s += 30;
    }
    if (wantedUs) {
      if (title === wantedUs) s += 80;
      else if (title.includes(wantedUs)) s += 40;
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
  return bestScore >= 30 ? best : null;
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
