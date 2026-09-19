/**
 * Bächli (BAE) permanently removed.
 * - Master/offer: blocked
 * - Stock feed: force QuantityOnStock=0 (delist prior pushes), same pattern as XNT
 * - Scraper code deleted
 * - DB purge: scripts/kill-bae-delete.ts --confirm=BAE_DELETE
 */

export const BAE_SUPPLIER_KEY = "bae";
export const BAE_PROVIDER_PREFIX = "BAE_";
export const BAE_DELETE_CONFIRM_TOKEN = "BAE_DELETE";

export function isBaeSupplierKey(input: {
  supplierKey?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
}): boolean {
  const key = String(input.supplierKey ?? "")
    .trim()
    .toLowerCase();
  if (key === BAE_SUPPLIER_KEY || key === "bächli" || key === "baechli") return true;

  const sv = String(input.supplierVariantId ?? "")
    .trim()
    .toLowerCase();
  if (sv.startsWith("bae_") || sv.startsWith("bae:")) return true;

  const pk = String(input.providerKey ?? "")
    .trim()
    .toUpperCase();
  return pk.startsWith(BAE_PROVIDER_PREFIX);
}

/** Block BAE from master / offer / candidate selection. */
export function isBaeFeedBlocked(input: {
  supplierKey?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
}): boolean {
  return isBaeSupplierKey(input);
}

/**
 * Force stock=0 in Galaxus stock CSV so previously pushed offers delist.
 * Unlike master/offer skip, stock feed must still emit zeros.
 */
export function shouldForceBaeStockZero(input: {
  supplierKey?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
}): boolean {
  return isBaeSupplierKey(input);
}

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
