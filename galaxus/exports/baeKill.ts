/**
 * Bächli (BAE) permanently removed from scraper + master/offer.
 * Galaxus stock delist is NOT applied on merge/deploy — dry-run then confirm.
 *
 *   npx tsx scripts/kill-bae-galaxus-delist.ts
 *   npx tsx scripts/kill-bae-galaxus-delist.ts --confirm=BAE_DELIST
 *
 * After confirm, set VPS env BAE_GALAXUS_STOCK_ZERO=1 (or re-run apply) so stock
 * feed emits QuantityOnStock=0 for BAE ProviderKeys, then upload stock feed.
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
export const BAE_DELIST_CONFIRM_TOKEN = "BAE_DELIST";

/** Env arm after human review of dry-run. */
export const BAE_STOCK_ZERO_ENV = "BAE_GALAXUS_STOCK_ZERO";

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

export function isBaeStockZeroArmed(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  return String(env[BAE_STOCK_ZERO_ENV] ?? "").trim() === "1";
}

/**
 * Force stock=0 in Galaxus stock CSV only when armed after confirmed apply.
 * Merge/deploy alone never arms this.
 */
export function shouldForceBaeStockZero(
  input: {
    supplierKey?: string | null;
    supplierVariantId?: string | null;
    providerKey?: string | null;
  },
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  if (!isBaeSupplierKey(input)) return false;
  return isBaeStockZeroArmed(env);
}

export { isDeadFeedBlocked, isDeadSupplier, shouldForceDeadStockZero };

export type BaeActiveListingRow = {
  providerKey: string;
  gtin: string | null;
  supplierVariantId: string | null;
  lastPushedStock: number | null;
  dbStock: number | null;
  status: string | null;
  channel: string;
};

export function summarizeBaeActiveListings(rows: BaeActiveListingRow[]): {
  total: number;
  withPositivePushedStock: number;
  withPositiveDbStock: number;
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
  providerKeys: string[];
  gtins: string[];
} {
  const byStatus: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  const providerKeys: string[] = [];
  const gtins: string[] = [];
  let withPositivePushedStock = 0;
  let withPositiveDbStock = 0;
  for (const row of rows) {
    const status = String(row.status ?? "UNKNOWN");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const ch = String(row.channel ?? "UNKNOWN");
    byChannel[ch] = (byChannel[ch] ?? 0) + 1;
    if (row.providerKey) providerKeys.push(row.providerKey);
    if (row.gtin) gtins.push(row.gtin);
    if ((row.lastPushedStock ?? 0) > 0) withPositivePushedStock += 1;
    if ((row.dbStock ?? 0) > 0) withPositiveDbStock += 1;
  }
  return {
    total: rows.length,
    withPositivePushedStock,
    withPositiveDbStock,
    byStatus,
    byChannel,
    providerKeys,
    gtins,
  };
}
