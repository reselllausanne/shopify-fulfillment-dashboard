import { prisma } from "@/app/lib/prisma";

/**
 * Post-sale identity: GTIN is optional. Bags / soft goods often have no UPC on
 * StockX; Shopify SKU is KickDB uuid + size (`<uuid>-OS`). Convergence and
 * KickDB refresh must still run on shopifyVariantId / KickDB product id.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Shopify SKU `<kickdbProductId>-OS` / `-42` → KickDB product id. */
export function kickdbProductIdFromShopifySku(sku: string | null | undefined): string | null {
  const raw = String(sku ?? "").trim();
  if (!raw) return null;
  // Strip trailing size: -OS, -O/S, -ONE SIZE, letter sizes, numeric EU sizes.
  const base = raw.replace(
    /-(?:[A-Z0-9]+(?:\/[A-Z0-9]+)+|XXXL|XXL|XL|XXS|XS|L|M|S|OS|O\/S|ONE\s*SIZE|EU\s*[1-9]\d?(?:[.,]\d+)?(?:\s+\d+\/\d+)?[NRMW]?|[1-9]\d?(?:[.,]\d+)?(?:\s+\d+\/\d+)?[NRMW]?)$/i,
    ""
  );
  const candidate = (base || raw).trim();
  if (UUID_RE.test(candidate)) return candidate.toLowerCase();
  // Bare uuid without size suffix.
  if (UUID_RE.test(raw)) return raw.toLowerCase();
  return null;
}

export type KickdbIdentity = {
  kickdbProductId: string | null;
  urlKey: string | null;
  styleId: string | null;
};

/** Resolve KickDB row from Shopify SKU uuid (or already-known KickDB id). */
export async function resolveKickdbIdentityFromSku(
  sku: string | null | undefined
): Promise<KickdbIdentity> {
  const empty: KickdbIdentity = { kickdbProductId: null, urlKey: null, styleId: null };
  const kickdbProductId = kickdbProductIdFromShopifySku(sku);
  if (!kickdbProductId) return empty;

  const row = await prisma.kickDBProduct.findFirst({
    where: {
      OR: [{ kickdbProductId }, { id: kickdbProductId }],
    },
    select: { kickdbProductId: true, urlKey: true, styleId: true },
    orderBy: { updatedAt: "desc" },
  });

  return {
    kickdbProductId: String(row?.kickdbProductId ?? kickdbProductId).trim() || kickdbProductId,
    urlKey: String(row?.urlKey ?? "").trim() || null,
    styleId: String(row?.styleId ?? "").trim() || null,
  };
}

/**
 * Best identifier for createProductFullFlow / KickDB fetch when GTIN missing:
 * urlKey → kickdbProductId → null.
 */
export async function resolvePostSaleProductIdentifier(input: {
  gtin?: string | null;
  sku?: string | null;
}): Promise<{ identifier: string | null; source: "gtin" | "urlKey" | "kickdbProductId" | null }> {
  const gtin = String(input.gtin ?? "").trim();
  if (gtin) return { identifier: gtin, source: "gtin" };

  const kick = await resolveKickdbIdentityFromSku(input.sku);
  if (kick.urlKey) return { identifier: kick.urlKey, source: "urlKey" };
  if (kick.kickdbProductId) {
    return { identifier: kick.kickdbProductId, source: "kickdbProductId" };
  }
  return { identifier: null, source: null };
}
