/**
 * Which client lines belong in Matching Review Lab StockX matching.
 * Shopify: all open physical lines (existing load filters).
 * Galaxus / Decathlon: STX_ only — never GLD/TRM/warehouse.
 */

import {
  galaxusLineWarehouseStockHint,
  isGalaxusStxSupplierLine,
} from "@/galaxus/warehouse/lineInventorySource";

export function isLabGalaxusStxLine(line: {
  supplierPid?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
  gtin?: string | null;
  productName?: string | null;
  description?: string | null;
  supplierSku?: string | null;
  warehouseMarkedShippedAt?: Date | string | null;
}): boolean {
  if (line.warehouseMarkedShippedAt) return false;
  if (!isGalaxusStxSupplierLine(line)) return false;
  if (galaxusLineWarehouseStockHint(line)) return false;
  return true;
}

/** Decathlon STX procurement lines (exclude GLD_/TRM_). */
export function isLabDecathlonStxLine(line: {
  providerKey?: string | null;
  supplierSku?: string | null;
  offerSku?: string | null;
  productSku?: string | null;
  rawJson?: unknown;
}): boolean {
  const pk = String(line.providerKey ?? "").trim().toUpperCase();
  if (pk.startsWith("GLD_") || pk.startsWith("TRM_")) return false;

  if (pk === "STX" || pk.startsWith("STX_")) return true;

  for (const raw of [line.supplierSku, line.offerSku, line.productSku]) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    if (s.toLowerCase().startsWith("stx_")) return true;
    if (s.toUpperCase().startsWith("STX_")) return true;
  }

  const raw = line.rawJson as Record<string, unknown> | null | undefined;
  if (raw && typeof raw === "object") {
    const sv = String(
      (raw as any).supplierVariantId ??
        (raw as any).offer_sku ??
        (raw as any).offerSku ??
        ""
    ).trim();
    if (sv.toLowerCase().startsWith("stx_")) return true;
    if (sv.toUpperCase().startsWith("STX_")) return true;
  }

  return false;
}

export function extractStxVariantId(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const id = s.toLowerCase().startsWith("stx_") ? s.replace(/^stx_/i, "") : s;
  // StockX productVariantId is a UUID — ignore STX_<gtin> placeholders.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  return null;
}
