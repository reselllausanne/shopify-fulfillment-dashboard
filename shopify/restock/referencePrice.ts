import { prisma } from "@/app/lib/prisma";
import { findShopifyVariantsByGtin, searchProductVariants } from "@/shopify/catalog/graphql";
import { ONLINE_LOCATION } from "@/shopify/inventory/locationConfig";
import {
  getInventoryAvailableAtLocation,
  getShopifyVariantDetail,
} from "@/shopify/restock/shopifyRestockInventory";

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function skuSizeSuffix(sku: string): string | null {
  const parts = String(sku).trim().split("-");
  if (parts.length < 2) return null;
  return parts[parts.length - 1] ?? null;
}

function skuStyleBase(sku: string): string | null {
  const parts = String(sku).trim().split("-");
  if (parts.length < 2) return null;
  return parts.slice(0, -1).join("-");
}

/**
 * Reference "full" retail anchor for liquidation compare-at:
 * 1) STX buy-now on SupplierVariant
 * 2) Same-size variant on another Shopify product with online/dropship stock
 *    (the listing that still has buy-now qty)
 * 3) Current variant compareAt (if already on sale) or price
 */
export async function resolveReferenceBuyNowPrice(input: {
  gtin: string;
  variantId?: string | null;
  sku?: string | null;
}): Promise<number | null> {
  const gtin = String(input.gtin ?? "").trim();
  if (!gtin) return null;

  const stxRow = await prisma.supplierVariant.findFirst({
    where: {
      gtin,
      supplierVariantId: { startsWith: "stx_" },
    },
    select: { price: true },
    orderBy: { updatedAt: "desc" },
  });
  const stxPrice = toNumber(stxRow?.price);
  if (stxPrice) return stxPrice;

  const sku = String(input.sku ?? "").trim();
  if (sku) {
    const onlineRef = await findShopifyOnlineReferencePriceBySku(sku, input.variantId ?? null);
    if (onlineRef) return onlineRef;
  }

  if (input.variantId) {
    const detail = await getShopifyVariantDetail(input.variantId);
    if (detail) {
      if (
        detail.compareAtPrice != null &&
        detail.price != null &&
        detail.compareAtPrice > detail.price
      ) {
        return detail.compareAtPrice;
      }
      if (detail.price != null) return detail.price;
    }
  }

  return null;
}

async function findShopifyOnlineReferencePriceBySku(
  sku: string,
  excludeVariantId: string | null
): Promise<number | null> {
  const onlineLocationId = ONLINE_LOCATION?.id;
  if (!onlineLocationId) return null;

  const styleBase = skuStyleBase(sku);
  const sizeSuffix = skuSizeSuffix(sku);
  if (!styleBase || !sizeSuffix) return null;

  const escaped = styleBase.replace(/"/g, '\\"');
  const matches = await searchProductVariants(`sku:${escaped}*`, 25);
  let best: number | null = null;

  for (const row of matches) {
    if (excludeVariantId && row.variantId === excludeVariantId) continue;
    const rowSku = String(row.sku ?? "").trim();
    if (!rowSku || skuSizeSuffix(rowSku) !== sizeSuffix) continue;
    if (!row.inventoryItemId) continue;

    const onlineQty = await getInventoryAvailableAtLocation({
      inventoryItemId: row.inventoryItemId,
      locationId: onlineLocationId,
    });
    if ((onlineQty ?? 0) <= 0) continue;

    const detail = await getShopifyVariantDetail(row.variantId);
    if (!detail) continue;
    const anchor =
      detail.compareAtPrice != null &&
      detail.price != null &&
      detail.compareAtPrice > detail.price
        ? detail.compareAtPrice
        : detail.price;
    if (anchor != null && (best == null || anchor > best)) {
      best = anchor;
    }
  }

  return best;
}
