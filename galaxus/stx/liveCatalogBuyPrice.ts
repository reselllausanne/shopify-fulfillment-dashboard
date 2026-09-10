import { fetchStockxProductByIdOrSlugRaw, kickdbVariantMatchesGtin } from "@/galaxus/kickdb/client";
import { isLegoStxProduct } from "@/galaxus/stx/legoProduct";
import { buildStxDualPriceFields, type StxDualPriceFields } from "@/galaxus/stx/variantPriceLanes";

function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function selectStxCatalogBuyPriceFromLanes(
  lanes: StxDualPriceFields,
  options?: { slug?: string | null; productName?: string | null }
): number | null {
  const stxIsLego = isLegoStxProduct({
    slug: options?.slug ?? null,
    name: options?.productName ?? null,
  });
  if (stxIsLego) {
    return toPositiveNumber(lanes.standardBuyPrice) ?? toPositiveNumber(lanes.price) ?? toPositiveNumber(lanes.expressBuyPrice);
  }
  return (
    toPositiveNumber(lanes.expressBuyPrice) ??
    toPositiveNumber(lanes.price) ??
    toPositiveNumber(lanes.standardBuyPrice)
  );
}

function selectCatalogDisplayBuyPriceFromDb(mapping: any): number | null {
  const supplierVariant = mapping?.supplierVariant ?? null;
  if (!supplierVariant) return null;
  const providerKey = String(supplierVariant?.providerKey ?? "").trim().toUpperCase();
  const supplierVariantId = String(supplierVariant?.supplierVariantId ?? "").trim().toLowerCase();
  const isStx = providerKey.startsWith("STX_") || supplierVariantId.startsWith("stx_");
  const base = toPositiveNumber(supplierVariant?.price);
  if (!isStx) return base;

  const kickdbProduct = mapping?.kickdbVariant?.product ?? null;
  const supplierName = String(supplierVariant?.supplierProductName ?? "").trim();
  const stxIsLego = isLegoStxProduct({
    slug: kickdbProduct?.urlKey ?? null,
    name: kickdbProduct?.name ?? supplierName,
  });
  const standard = toPositiveNumber(supplierVariant?.standardBuyPrice);
  const express = toPositiveNumber(supplierVariant?.expressBuyPrice);

  if (stxIsLego) return standard ?? base ?? express;
  return express ?? base ?? standard;
}

function isStxMapping(mapping: any): boolean {
  const supplierVariant = mapping?.supplierVariant ?? null;
  if (!supplierVariant) return false;
  const providerKey = String(supplierVariant?.providerKey ?? "").trim().toUpperCase();
  const supplierVariantId = String(supplierVariant?.supplierVariantId ?? "").trim().toLowerCase();
  return providerKey.startsWith("STX_") || supplierVariantId.startsWith("stx_");
}

function findKickdbVariantForMapping(product: any, mapping: any): any | null {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const gtin = String(mapping?.gtin ?? mapping?.supplierVariant?.gtin ?? "").trim();
  if (gtin) {
    const byGtin = variants.find((variant: any) => kickdbVariantMatchesGtin(variant, gtin));
    if (byGtin) return byGtin;
  }

  const kickdbVariantId = String(mapping?.kickdbVariant?.kickdbVariantId ?? "").trim();
  if (kickdbVariantId) {
    const byId = variants.find((variant: any) => String(variant?.id ?? "").trim() === kickdbVariantId);
    if (byId) return byId;
  }

  const sizeEu = String(mapping?.kickdbVariant?.sizeEu ?? "").trim();
  if (sizeEu) {
    const normalized = sizeEu.replace(/^EU\s*/i, "").trim();
    return (
      variants.find((variant: any) =>
        (variant?.sizes ?? []).some(
          (row: any) =>
            String(row?.type ?? "").toLowerCase() === "eu" &&
            String(row?.size ?? "")
              .replace(/^EU\s*/i, "")
              .trim() === normalized
        )
      ) ?? null
    );
  }

  return null;
}

export async function resolveLiveStxCatalogBuyPriceForMapping(
  mapping: any,
  productCache: Map<string, any>
): Promise<number | null> {
  if (!isStxMapping(mapping)) return selectCatalogDisplayBuyPriceFromDb(mapping);

  const slug = String(mapping?.kickdbVariant?.product?.urlKey ?? "").trim();
  if (!slug) return selectCatalogDisplayBuyPriceFromDb(mapping);

  let product = productCache.get(slug);
  if (!product) {
    try {
      const res = await fetchStockxProductByIdOrSlugRaw(slug);
      product = res.product;
      productCache.set(slug, product);
    } catch {
      return selectCatalogDisplayBuyPriceFromDb(mapping);
    }
  }

  const variant = findKickdbVariantForMapping(product, mapping);
  if (!variant) return selectCatalogDisplayBuyPriceFromDb(mapping);

  const productName = String(product?.title ?? product?.primary_title ?? mapping?.supplierVariant?.supplierProductName ?? "").trim() || null;
  const lanes = buildStxDualPriceFields(variant, product, productName, {
    slug,
  });
  if (!lanes) return selectCatalogDisplayBuyPriceFromDb(mapping);

  return selectStxCatalogBuyPriceFromLanes(lanes, { slug, productName });
}

/** Warehouse UI: prefer live KickDB express buy over stale SupplierVariant columns. */
export async function hydrateLiveStxCatalogPricesByGtin(
  mappings: any[],
  catalogPriceByGtin: Record<string, number>,
  canonByMapping: Array<{ mapping: any; canon: string }>
): Promise<void> {
  const productCache = new Map<string, any>();
  const pending = new Map<string, Promise<number | null>>();

  for (const { mapping, canon } of canonByMapping) {
    if (!canon || catalogPriceByGtin[canon] == null) continue;
    if (!isStxMapping(mapping)) continue;
    if (pending.has(canon)) continue;

    pending.set(
      canon,
      resolveLiveStxCatalogBuyPriceForMapping(mapping, productCache).catch(() => null)
    );
  }

  const resolved = await Promise.all(
    Array.from(pending.entries()).map(async ([canon, promise]) => [canon, await promise] as const)
  );
  for (const [canon, price] of resolved) {
    if (price != null && Number.isFinite(price) && price > 0) {
      catalogPriceByGtin[canon] = price;
    }
  }
}
