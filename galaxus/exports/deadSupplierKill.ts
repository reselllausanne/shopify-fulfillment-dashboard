/**
 * Permanently killed scrapers (code deleted).
 *
 * HHV / SNL / NSO: stock feed auto force-zeros (delist leftovers).
 * BAE: scraper gone + master/offer blocked, but Galaxus stock zero is
 * gated behind explicit dry-run → confirm apply (see scripts/kill-bae-galaxus-delist.ts).
 * Do NOT auto-delist BAE on merge/deploy.
 */

export const DEAD_SUPPLIER_KEYS = ["bae", "hhv", "snl", "nso"] as const;
export type DeadSupplierKey = (typeof DEAD_SUPPLIER_KEYS)[number];

/** Auto stock-zero on every Galaxus stock export (not BAE). */
export const AUTO_STOCK_ZERO_KEYS = ["hhv", "snl", "nso"] as const;

export const DEAD_DELETE_CONFIRM_TOKEN = "DEAD_DELETE";

const KEY_ALIASES: Record<string, DeadSupplierKey> = {
  bae: "bae",
  bächli: "bae",
  baechli: "bae",
  hhv: "hhv",
  snl: "snl",
  snowleader: "snl",
  nso: "nso",
  newsole: "nso",
};

export function resolveDeadSupplierKey(input: {
  supplierKey?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
}): DeadSupplierKey | null {
  const key = String(input.supplierKey ?? "")
    .trim()
    .toLowerCase();
  if (key && KEY_ALIASES[key]) return KEY_ALIASES[key];

  const sv = String(input.supplierVariantId ?? "")
    .trim()
    .toLowerCase();
  for (const dead of DEAD_SUPPLIER_KEYS) {
    if (sv.startsWith(`${dead}_`) || sv.startsWith(`${dead}:`)) return dead;
  }

  const pk = String(input.providerKey ?? "")
    .trim()
    .toUpperCase();
  for (const dead of DEAD_SUPPLIER_KEYS) {
    if (pk.startsWith(`${dead.toUpperCase()}_`)) return dead;
  }
  return null;
}

export function isDeadSupplier(input: {
  supplierKey?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
}): boolean {
  return resolveDeadSupplierKey(input) != null;
}

/** Block from master / offer / candidate selection (includes BAE). */
export function isDeadFeedBlocked(input: {
  supplierKey?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
}): boolean {
  return isDeadSupplier(input);
}

/**
 * Auto force QuantityOnStock=0 — HHV/SNL/NSO only.
 * BAE uses shouldForceBaeStockZero after confirmed apply.
 */
export function shouldForceDeadStockZero(input: {
  supplierKey?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
}): boolean {
  const key = resolveDeadSupplierKey(input);
  if (!key) return false;
  return (AUTO_STOCK_ZERO_KEYS as readonly string[]).includes(key);
}
