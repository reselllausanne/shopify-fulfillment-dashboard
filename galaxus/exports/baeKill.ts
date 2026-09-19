/**
 * Bächli (BAE) kill — permanently exclude from Galaxus catalog feeds.
 *
 * Merge/deploy of this code does NOT zero live Galaxus offers.
 * Delist of existing ACTIVE listings is an explicit CLI apply only:
 *   npx tsx scripts/kill-bae-galaxus-delist.ts
 *   npx tsx scripts/kill-bae-galaxus-delist.ts --apply --confirm=BAE_DELIST_GALAXUS
 */

export const BAE_SUPPLIER_KEY = "bae";
export const BAE_PROVIDER_PREFIX = "BAE_";
export const BAE_DELIST_CONFIRM_TOKEN = "BAE_DELIST_GALAXUS";

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

/**
 * Block BAE from master / offer / candidate selection.
 * Does NOT force stock=0 — that would delist on the next stock upload after merge.
 */
export function isBaeFeedBlocked(input: {
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

/** Galaxus stock CSV header used by our stock export. */
export function formatBaeDelistStockCsvRow(providerKey: string): string {
  return `${providerKey},0`;
}

export function buildBaeDelistStockCsv(providerKeys: string[]): string {
  const header = "ProviderKey,QuantityOnStock";
  const body = providerKeys
    .filter(Boolean)
    .map((pk) => formatBaeDelistStockCsvRow(pk))
    .join("\n");
  return body ? `${header}\n${body}\n` : `${header}\n`;
}
