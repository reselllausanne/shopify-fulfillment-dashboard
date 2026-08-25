import { isGalaxusStxSupplierLine } from "@/galaxus/warehouse/lineInventorySource";
import { extractProviderKeyFromOrderKey, normalizeProviderKey } from "@/galaxus/supplier/providerKey";

/** Suppliers that use GalaxusExternalBuy (not StockX). */
export const EXTERNAL_BUY_SUPPLIER_KEYS = new Set([
  "REI",
  "WEL",
  "SNL",
  "BAE",
  "TRM",
  "GLD",
]);

export function resolveLineSupplierKey(line: {
  supplierPid?: string | null;
  providerKey?: string | null;
  supplierSku?: string | null;
  supplierVariantId?: string | null;
}): string | null {
  for (const raw of [line.providerKey, line.supplierPid, line.supplierSku, line.supplierVariantId]) {
    const fromKey = extractProviderKeyFromOrderKey(raw) ?? normalizeProviderKey(raw);
    if (fromKey) return fromKey;
  }
  return null;
}

export function isExternalBuyEligibleLine(line: {
  supplierPid?: string | null;
  providerKey?: string | null;
  supplierSku?: string | null;
  supplierVariantId?: string | null;
}): boolean {
  if (isGalaxusStxSupplierLine(line)) return false;
  const key = resolveLineSupplierKey(line);
  return Boolean(key && EXTERNAL_BUY_SUPPLIER_KEYS.has(key));
}

export function normalizeExternalSupplierKey(value: unknown): string | null {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!raw) return null;
  const key = raw.slice(0, 3);
  return EXTERNAL_BUY_SUPPLIER_KEYS.has(key) ? key : null;
}

export type ExternalBuyRow = {
  id: string;
  galaxusOrderLineId: string;
  unitIndex: number;
  supplierKey: string;
  supplierOrderNumber: string;
  costAmount?: unknown;
  currencyCode?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  etaMin?: Date | string | null;
  etaMax?: Date | string | null;
  status?: string | null;
  note?: string | null;
  cancelledAt?: Date | string | null;
};

export function activeExternalBuysForLine(
  buys: ExternalBuyRow[],
  lineId: string
): ExternalBuyRow[] {
  return buys
    .filter(
      (b) =>
        String(b.galaxusOrderLineId) === String(lineId) &&
        !b.cancelledAt
    )
    .sort((a, b) => Number(a.unitIndex) - Number(b.unitIndex));
}

export function sumExternalBuyCostChf(buys: ExternalBuyRow[]): number | null {
  let sum = 0;
  let any = false;
  for (const b of buys) {
    const n = b.costAmount != null ? Number(b.costAmount) : NaN;
    if (!Number.isFinite(n)) continue;
    sum += n;
    any = true;
  }
  return any ? sum : null;
}
