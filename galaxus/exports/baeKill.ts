/**
 * Bächli (BAE) permanently removed.
 * Shared dead-supplier helpers (BAE+HHV+SNL+NSO): galaxus/exports/deadSupplierKill.ts
 */
import {
  isDeadFeedBlocked,
  isDeadSupplier,
  resolveDeadSupplierKey,
  shouldForceDeadStockZero,
} from "@/galaxus/exports/deadSupplierKill";

export const BAE_SUPPLIER_KEY = "bae";
export const BAE_PROVIDER_PREFIX = "BAE_";
export const BAE_DELETE_CONFIRM_TOKEN = "BAE_DELETE";

export function isBaeSupplierKey(input: {
  supplierKey?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
}): boolean {
  return resolveDeadSupplierKey(input) === "bae";
}

export function isBaeFeedBlocked(input: {
  supplierKey?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
}): boolean {
  return isBaeSupplierKey(input);
}

export function shouldForceBaeStockZero(input: {
  supplierKey?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
}): boolean {
  return isBaeSupplierKey(input);
}

/** Prefer these for multi-supplier kill (BAE+HHV+SNL+NSO). */
export { isDeadFeedBlocked, isDeadSupplier, shouldForceDeadStockZero };

export type BaeActiveListingRow = {
  providerKey: string;
  gtin: string | null;
  supplierVariantId: string | null;
  lastPushedStock: number | null;
  status: string | null;
  channel: string;
};

export function summarizeBaeActiveListings(rows: BaeActiveListingRow[]): {
  total: number;
  byStatus: Record<string, number>;
  providerKeys: string[];
} {
  const byStatus: Record<string, number> = {};
  const providerKeys: string[] = [];
  for (const row of rows) {
    const status = String(row.status ?? "UNKNOWN");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (row.providerKey) providerKeys.push(row.providerKey);
  }
  return { total: rows.length, byStatus, providerKeys };
}
