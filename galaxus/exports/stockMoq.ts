import { parseSupplierKeyFromVariantId } from "@/galaxus/exports/supplierKey";

/**
 * Per-supplier Galaxus stock-feed MOQ / order-step.
 * Affects stock CSV only (checkout min qty). Does not change EDI ingest, invoices, or fulfillment.
 *
 * Galaxus rule: MOQ must be >= OrderQuantitySteps. Default both = 1.
 */
export type GalaxusStockMoq = {
  minimumOrderQuantity: number;
  orderQuantitySteps: number;
};

const DEFAULT_MOQ: GalaxusStockMoq = {
  minimumOrderQuantity: 1,
  orderQuantitySteps: 1,
};

/** Supplier keys (lowercase id prefix) → MOQ. Unlisted suppliers keep default 1/1. */
const SUPPLIER_STOCK_MOQ: Record<string, GalaxusStockMoq> = {
  // Golden (GLD): pack of 5 to keep dropship viable
  golden: { minimumOrderQuantity: 5, orderQuantitySteps: 1 },
  gld: { minimumOrderQuantity: 5, orderQuantitySteps: 1 },
};

function normalizeSupplierKey(raw?: string | null): string | null {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase();
  return key || null;
}

export function resolveGalaxusStockMoq(input: {
  supplierKey?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
}): GalaxusStockMoq {
  const fromKey = normalizeSupplierKey(input.supplierKey);
  if (fromKey && SUPPLIER_STOCK_MOQ[fromKey]) {
    return SUPPLIER_STOCK_MOQ[fromKey];
  }

  const fromVariant = parseSupplierKeyFromVariantId(input.supplierVariantId);
  if (fromVariant && SUPPLIER_STOCK_MOQ[fromVariant]) {
    return SUPPLIER_STOCK_MOQ[fromVariant];
  }

  // ProviderKey prefix fallback (e.g. GLD_4067…)
  const providerKey = String(input.providerKey ?? "").trim();
  if (providerKey.includes("_")) {
    const prefix = providerKey.split("_")[0]?.toLowerCase() ?? "";
    if (prefix && SUPPLIER_STOCK_MOQ[prefix]) {
      return SUPPLIER_STOCK_MOQ[prefix];
    }
  }

  return DEFAULT_MOQ;
}

export function formatGalaxusStockMoqFields(moq: GalaxusStockMoq): {
  MinimumOrderQuantity: string;
  OrderQuantitySteps: string;
} {
  const minimumOrderQuantity = Math.max(1, Math.floor(moq.minimumOrderQuantity));
  const orderQuantitySteps = Math.max(1, Math.floor(moq.orderQuantitySteps));
  // Galaxus rejects MOQ < OQS — clamp steps down if misconfigured.
  const safeSteps = Math.min(orderQuantitySteps, minimumOrderQuantity);
  return {
    MinimumOrderQuantity: String(minimumOrderQuantity),
    OrderQuantitySteps: String(safeSteps),
  };
}

/** Hide variants that cannot satisfy MOQ (e.g. GLD stock 1–4 with MOQ 5). */
export function meetsGalaxusStockMoq(stock: number, moq: GalaxusStockMoq): boolean {
  if (!Number.isFinite(stock) || stock < 0) return false;
  const minQty = Math.max(1, Math.floor(moq.minimumOrderQuantity));
  return stock >= minQty;
}
