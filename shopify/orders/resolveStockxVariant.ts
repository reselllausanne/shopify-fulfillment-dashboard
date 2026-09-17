import { prisma } from "@/app/lib/prisma";
import { skuBaseFromShopifySKU } from "@/app/utils/matching";
import { normalizeGtinKey, resolveStxNeedsFromGtinQuantities } from "@/galaxus/stx/purchaseUnits";

export function normalizeSizeKey(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/^(EU|US|UK|ASIA)\s+/i, "")
    .replace(/,/g, ".")
    .replace(/\s+/g, "");
}

export function stripStxPrefix(supplierVariantId: string | null | undefined): string | null {
  const raw = String(supplierVariantId ?? "").trim();
  if (!raw) return null;
  return raw.replace(/^stx_/i, "") || null;
}

/**
 * Shopify line → StockX variant id (same identity Galaxus auto-link uses).
 * 1) barcode/GTIN → VariantMapping stx_*
 * 2) style SKU + size → SupplierVariant
 */
export async function resolveStockxVariantIdForShopifyLine(line: {
  sku?: string | null;
  sizeEU?: string | null;
  variantTitle?: string | null;
  gtin?: string | null;
  quantity?: number | null;
}): Promise<string | null> {
  const gtin = normalizeGtinKey(line.gtin);
  const qty = Math.max(1, Math.round(Number(line.quantity ?? 1)));
  if (gtin) {
    const needs = await resolveStxNeedsFromGtinQuantities(new Map([[gtin, qty]]));
    const fromGtin = stripStxPrefix(needs[0]?.supplierVariantId);
    if (fromGtin) return fromGtin;
  }

  const styleSku = skuBaseFromShopifySKU(line.sku ?? null);
  if (!styleSku) return null;

  const rows = await prisma.supplierVariant.findMany({
    where: {
      supplierSku: styleSku,
      supplierVariantId: { startsWith: "stx_" },
    },
    select: {
      supplierVariantId: true,
      sizeNormalized: true,
      sizeRaw: true,
    },
    take: 40,
  });
  if (rows.length === 0) {
    const loose = await prisma.supplierVariant.findMany({
      where: {
        supplierSku: { equals: styleSku, mode: "insensitive" },
        supplierVariantId: { startsWith: "stx_" },
      },
      select: {
        supplierVariantId: true,
        sizeNormalized: true,
        sizeRaw: true,
      },
      take: 40,
    });
    rows.push(...loose);
  }

  const wantSize = normalizeSizeKey(line.sizeEU || line.variantTitle);
  const sized = rows.filter((row) => {
    const have = normalizeSizeKey(row.sizeNormalized || row.sizeRaw);
    if (!wantSize) return !have;
    return have === wantSize;
  });
  const picked = (sized.length === 1 ? sized[0] : null) ?? (rows.length === 1 && !wantSize ? rows[0] : null);
  return stripStxPrefix(picked?.supplierVariantId);
}
