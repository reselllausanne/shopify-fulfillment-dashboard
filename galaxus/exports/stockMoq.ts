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
  // Golden (GLD): MOQ 3 — batch multiple Galaxus orders into ~10-pair PL→CH shipments
  golden: { minimumOrderQuantity: 3, orderQuantitySteps: 1 },
  gld: { minimumOrderQuantity: 3, orderQuantitySteps: 1 },
};

function normalizeSupplierKey(raw?: string | null): string | null {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase();
  return key || null;
}

/** Parse `moq=10` / `oqs=10` tokens from operator notes (e.g. mq2-liquidation). */
export function parseMoqFromManualNote(manualNote?: string | null): GalaxusStockMoq | null {
  const note = String(manualNote ?? "");
  const moqMatch = note.match(/\bmoq\s*=\s*(\d+)\b/i);
  if (!moqMatch) return null;
  const minimumOrderQuantity = Number.parseInt(moqMatch[1]!, 10);
  if (!Number.isFinite(minimumOrderQuantity) || minimumOrderQuantity < 1) return null;
  const oqsMatch = note.match(/\boqs\s*=\s*(\d+)\b/i);
  const orderQuantitySteps = oqsMatch
    ? Number.parseInt(oqsMatch[1]!, 10)
    : minimumOrderQuantity;
  if (!Number.isFinite(orderQuantitySteps) || orderQuantitySteps < 1) {
    return { minimumOrderQuantity, orderQuantitySteps: minimumOrderQuantity };
  }
  return { minimumOrderQuantity, orderQuantitySteps };
}

/**
 * Write/replace `moq=` / `oqs=` tokens in a manual note.
 * Pass null/undefined to strip MOQ tokens (leave rest of note intact).
 * When only moq is set, also write oqs=moq so Galaxus checkout steps match.
 */
export function mergeMoqIntoManualNote(
  manualNote: string | null | undefined,
  moq: number | null | undefined,
  oqs?: number | null
): string | null {
  const stripped = String(manualNote ?? "")
    .replace(/\bmoq\s*=\s*\d+\b/gi, " ")
    .replace(/\boqs\s*=\s*\d+\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const minQty =
    moq == null || !Number.isFinite(moq) ? null : Math.max(1, Math.floor(moq));
  if (minQty == null) {
    return stripped || null;
  }

  const stepsRaw =
    oqs == null || !Number.isFinite(oqs) ? minQty : Math.max(1, Math.floor(oqs));
  const steps = Math.min(stepsRaw, minQty);
  const token = `moq=${minQty} oqs=${steps}`;
  return stripped ? `${stripped} ${token}` : token;
}

export function resolveGalaxusStockMoq(input: {
  supplierKey?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
  /** Operator note override, e.g. `mq2-liquidation unit=67 moq=10 oqs=10`. */
  manualNote?: string | null;
}): GalaxusStockMoq {
  const fromNote = parseMoqFromManualNote(input.manualNote);
  if (fromNote) return fromNote;

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
