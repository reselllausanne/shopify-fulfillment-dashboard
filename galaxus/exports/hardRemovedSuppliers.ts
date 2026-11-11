import { galaxusDisabledSuppliers } from "@/galaxus/exports/assortmentPolicy";

/**
 * Suppliers removed from every Galaxus feed (master, specs, offer, stock) — not only gated in
 * stock/offer. Scraped data stays in the DB; nothing is sent. Re-enable: drop the key from
 * GALAXUS_DISABLED_SUPPLIERS (default in assortmentPolicy.ts) and rebuild the snapshots.
 *
 * 2026-11-11: alt haw exl ven wrk fan bae bwz (Galaxus category complaint; unused until next year).
 * Intersected with galaxusDisabledSuppliers() so GALAXUS_DISABLED_SUPPLIERS="" still opens everything
 * (rei / wel keep their per-SKU exceptions and are intentionally NOT in this list).
 */
export const GALAXUS_HARD_REMOVE_CANDIDATES: readonly string[] = [
  "alt",
  "haw",
  "exl",
  "ven",
  "wrk",
  "fan",
  "bae",
  "bwz",
];

export function galaxusHardRemovedSuppliers(): Set<string> {
  const disabled = galaxusDisabledSuppliers();
  return new Set(GALAXUS_HARD_REMOVE_CANDIDATES.filter((key) => disabled.has(key)));
}

export function supplierKeyFromProviderKey(providerKey: string | null | undefined): string {
  return String(providerKey ?? "").trim().split("_")[0].toLowerCase();
}

export function isHardRemovedProviderKey(
  providerKey: string | null | undefined,
  removed: ReadonlySet<string> = galaxusHardRemovedSuppliers()
): boolean {
  if (removed.size === 0) return false;
  return removed.has(supplierKeyFromProviderKey(providerKey));
}
