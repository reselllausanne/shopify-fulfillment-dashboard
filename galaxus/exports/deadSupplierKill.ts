/**
 * Permanently killed scrapers (code deleted).
 * - Master/offer: blocked
 * - Stock feed: force QuantityOnStock=0 (delist prior pushes)
 * - DB purge: scripts/kill-dead-suppliers-delete.ts --confirm=DEAD_DELETE
 *
 * Keys: bae (Bächli), hhv (HHV), snl (Snowleader — no GTIN), nso (Newsole)
 */

export const DEAD_SUPPLIER_KEYS = ["bae", "hhv", "snl", "nso"] as const;
export type DeadSupplierKey = (typeof DEAD_SUPPLIER_KEYS)[number];

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

/** Block from master / offer / candidate selection. */
export function isDeadFeedBlocked(input: {
  supplierKey?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
}): boolean {
  return isDeadSupplier(input);
}

/** Force stock=0 in Galaxus stock CSV so previously pushed offers delist. */
export function shouldForceDeadStockZero(input: {
  supplierKey?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
}): boolean {
  return isDeadSupplier(input);
}
