import { isLegoStxProduct } from "@/galaxus/stx/legoProduct";

function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isStxSupplierVariant(supplierVariant: {
  providerKey?: string | null;
  supplierVariantId?: string | null;
} | null | undefined): boolean {
  if (!supplierVariant) return false;
  const providerKey = String(supplierVariant.providerKey ?? "").trim().toUpperCase();
  const supplierVariantId = String(supplierVariant.supplierVariantId ?? "").trim().toLowerCase();
  return providerKey.startsWith("STX_") || supplierVariantId.startsWith("stx_");
}

export type StxWarehouseBuyRef = {
  price: number | null;
  /** StockX lane matching `price` — warehouse should buy here when possible. */
  lane: "standard" | "express" | null;
};

/**
 * Warehouse buy reference: cheapest StockX lane with a stored CHF buy price.
 * Marketplace `price` may track express-first; ops want the lowest fillable ask.
 */
export function selectStxWarehouseBuyRef(mapping: {
  supplierVariant?: {
    providerKey?: string | null;
    supplierVariantId?: string | null;
    price?: unknown;
    deliveryType?: string | null;
    standardBuyPrice?: unknown;
    expressBuyPrice?: unknown;
    supplierProductName?: string | null;
  } | null;
  kickdbVariant?: { product?: { urlKey?: string | null; name?: string | null } | null } | null;
} | null | undefined): StxWarehouseBuyRef {
  const supplierVariant = mapping?.supplierVariant ?? null;
  if (!supplierVariant || !isStxSupplierVariant(supplierVariant)) {
    return { price: null, lane: null };
  }

  const base = toPositiveNumber(supplierVariant.price);
  const standard = toPositiveNumber(supplierVariant.standardBuyPrice);
  const express = toPositiveNumber(supplierVariant.expressBuyPrice);
  const deliveryType = String(supplierVariant.deliveryType ?? "").trim().toLowerCase();

  const kickdbProduct = mapping?.kickdbVariant?.product ?? null;
  const supplierName = String(supplierVariant.supplierProductName ?? "").trim();
  const stxIsLego = isLegoStxProduct({
    slug: kickdbProduct?.urlKey ?? null,
    name: kickdbProduct?.name ?? supplierName,
  });

  if (stxIsLego) {
    const price = standard ?? base ?? express;
    return { price, lane: price === standard ? "standard" : price === express ? "express" : null };
  }

  if (standard != null && express != null) {
    if (standard <= express) return { price: standard, lane: "standard" };
    return { price: express, lane: "express" };
  }
  if (base != null) {
    if (deliveryType === "standard") return { price: base, lane: "standard" };
    if (deliveryType.includes("express")) return { price: base, lane: "express" };
    return { price: base, lane: null };
  }
  if (standard != null) return { price: standard, lane: "standard" };
  if (express != null) return { price: express, lane: "express" };
  return { price: null, lane: null };
}

export function selectStxCatalogDisplayBuyPrice(mapping: {
  supplierVariant?: {
    providerKey?: string | null;
    supplierVariantId?: string | null;
    price?: unknown;
    deliveryType?: string | null;
    standardBuyPrice?: unknown;
    expressBuyPrice?: unknown;
    supplierProductName?: string | null;
  } | null;
  kickdbVariant?: { product?: { urlKey?: string | null; name?: string | null } | null } | null;
} | null | undefined): number | null {
  return selectStxWarehouseBuyRef(mapping).price;
}

export function selectCatalogDisplayBuyPrice(mapping: {
  supplierVariant?: {
    providerKey?: string | null;
    supplierVariantId?: string | null;
    price?: unknown;
    deliveryType?: string | null;
    standardBuyPrice?: unknown;
    expressBuyPrice?: unknown;
    supplierProductName?: string | null;
  } | null;
  kickdbVariant?: { product?: { urlKey?: string | null; name?: string | null } | null } | null;
} | null | undefined): number | null {
  const supplierVariant = mapping?.supplierVariant ?? null;
  if (!supplierVariant) return null;
  if (isStxSupplierVariant(supplierVariant)) {
    return selectStxCatalogDisplayBuyPrice(mapping);
  }
  return toPositiveNumber(supplierVariant.price);
}
