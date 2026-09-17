import { fetchStockxProductByIdOrSlugRaw, extractVariantGtin } from "@/galaxus/kickdb/client";
import { kickdbStockxFetchId } from "@/galaxus/jobs/stxSync";
import { buildStxDualPriceFields } from "@/galaxus/stx/variantPriceLanes";
import { selectStxActiveOffer, selectStxStandardOffer } from "@/galaxus/stx/offerSelection";
import { isStxListingEligibleAsks } from "@/galaxus/stx/stockPublish";
import { prisma } from "@/app/lib/prisma";
import { expandGtinsForDbLookup } from "@/galaxus/stx/purchaseUnits";

export type StxAvailabilityStatus = "OK" | "OUT_OF_STOCK" | "UNKNOWN" | "NO_VARIANT";

export type StxAvailability = {
  status: StxAvailabilityStatus;
  /** Raw StockX ask count mirrored in SupplierVariant.stock. */
  stock: number | null;
  deliveryType: string | null;
  supplierVariantId: string | null;
  updatedAt: string | null;
  source: "db" | "live";
};

type SupplierVariantLike = {
  supplierVariantId?: string | null;
  providerKey?: string | null;
  stock?: unknown;
  deliveryType?: string | null;
  updatedAt?: Date | string | null;
};

function isStxSupplierVariant(sv: SupplierVariantLike | null | undefined): boolean {
  if (!sv) return false;
  const providerKey = String(sv.providerKey ?? "").trim().toUpperCase();
  const id = String(sv.supplierVariantId ?? "").trim().toLowerCase();
  return providerKey.startsWith("STX_") || id.startsWith("stx_");
}

function toStock(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
}

function maxAsksFromVariantPrices(prices: unknown): number {
  const express = selectStxActiveOffer(prices);
  const standard = selectStxStandardOffer(prices);
  return Math.max(express?.asks ?? 0, standard?.asks ?? 0);
}

export function stxAvailabilityFromSupplierVariant(
  sv: SupplierVariantLike | null | undefined,
  requestedQty = 1
): StxAvailability | null {
  if (!isStxSupplierVariant(sv)) return null;
  const stock = toStock(sv?.stock);
  const updatedAtRaw = sv?.updatedAt;
  const updatedAt =
    updatedAtRaw instanceof Date
      ? updatedAtRaw.toISOString()
      : updatedAtRaw
        ? String(updatedAtRaw)
        : null;
  if (stock === null) {
    return {
      status: "UNKNOWN",
      stock: null,
      deliveryType: sv?.deliveryType != null ? String(sv.deliveryType) : null,
      supplierVariantId: sv?.supplierVariantId != null ? String(sv.supplierVariantId) : null,
      updatedAt,
      source: "db",
    };
  }
  const available = stock >= Math.max(1, requestedQty);
  return {
    status: available ? "OK" : "OUT_OF_STOCK",
    stock,
    deliveryType: sv?.deliveryType != null ? String(sv.deliveryType) : null,
    supplierVariantId: sv?.supplierVariantId != null ? String(sv.supplierVariantId) : null,
    updatedAt,
    source: "db",
  };
}

export function stxAvailabilityFromMapping(
  mapping: { supplierVariant?: SupplierVariantLike | null } | null | undefined,
  requestedQty = 1
): StxAvailability | null {
  return stxAvailabilityFromSupplierVariant(mapping?.supplierVariant ?? null, requestedQty);
}

async function resolveKickdbProductForGtin(gtin: string) {
  const lookupGtins = expandGtinsForDbLookup([gtin]);
  const mapping = await (prisma as any).variantMapping.findFirst({
    where: {
      gtin: { in: lookupGtins },
      supplierVariantId: { startsWith: "stx_" },
    },
    include: {
      supplierVariant: true,
      kickdbVariant: { include: { product: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return mapping;
}

export async function fetchLiveStxAvailabilityForGtin(
  gtin: string,
  requestedQty = 1
): Promise<StxAvailability> {
  const cleanGtin = String(gtin ?? "").trim();
  if (!cleanGtin) {
    return {
      status: "NO_VARIANT",
      stock: null,
      deliveryType: null,
      supplierVariantId: null,
      updatedAt: null,
      source: "live",
    };
  }

  const mapping = await resolveKickdbProductForGtin(cleanGtin);
  const productRow = mapping?.kickdbVariant?.product ?? null;
  const supplierVariantId = String(mapping?.supplierVariantId ?? "").trim() || null;
  const fetchId = productRow ? kickdbStockxFetchId(productRow) : "";
  if (!fetchId) {
    const dbOnly = stxAvailabilityFromSupplierVariant(mapping?.supplierVariant ?? null, requestedQty);
    return (
      dbOnly ?? {
        status: "NO_VARIANT",
        stock: null,
        deliveryType: null,
        supplierVariantId,
        updatedAt: null,
        source: "live",
      }
    );
  }

  try {
    const { product } = await fetchStockxProductByIdOrSlugRaw(fetchId);
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    const lookup = expandGtinsForDbLookup([cleanGtin]);
    let matched: ReturnType<typeof buildStxDualPriceFields> = null;
    let matchedVariant: any = null;
    for (const variant of variants) {
      const variantGtin = String(extractVariantGtin(variant) ?? "").trim();
      if (!variantGtin || !lookup.includes(variantGtin.replace(/^0+/, "") || "0")) {
        const padded = variantGtin.padStart(13, "0");
        if (!lookup.some((g) => g === variantGtin || g === padded || g.endsWith(variantGtin.slice(-12)))) {
          continue;
        }
      }
      matched = buildStxDualPriceFields(variant, product, String(product?.title ?? "").trim() || null);
      matchedVariant = variant;
      if (matched) break;
    }

    if (!matched) {
      return {
        status: "OUT_OF_STOCK",
        stock: 0,
        deliveryType: null,
        supplierVariantId,
        updatedAt: new Date().toISOString(),
        source: "live",
      };
    }

    const stock = Math.max(
      0,
      Math.trunc(maxAsksFromVariantPrices(matchedVariant?.prices ?? null))
    );
    const available = isStxListingEligibleAsks(stock) && stock >= Math.max(1, requestedQty);
    return {
      status: available ? "OK" : "OUT_OF_STOCK",
      stock,
      deliveryType: matched.deliveryType ?? null,
      supplierVariantId,
      updatedAt: new Date().toISOString(),
      source: "live",
    };
  } catch {
    const dbOnly = stxAvailabilityFromSupplierVariant(mapping?.supplierVariant ?? null, requestedQty);
    return (
      dbOnly ?? {
        status: "UNKNOWN",
        stock: null,
        deliveryType: null,
        supplierVariantId,
        updatedAt: null,
        source: "live",
      }
    );
  }
}
