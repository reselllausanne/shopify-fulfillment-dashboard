/**
 * Adapter interface for wiring one supplier at a time to SupplierVariantObservation.
 * No scraper business logic here — scrapers opt in later by implementing this.
 */

import type { SupplierVariantObservation } from "./types";
import { isObservationContractImplemented } from "./contractRegistry";

export type SupplierObservationAdapter = {
  supplierKey: string;
  /**
   * Convert scraper-native row(s) from THIS run into observation payloads.
   * Must not read historical SupplierVariant.stock as proof.
   */
  toObservations(input: {
    scrapeRunId: number;
    observedAt: Date;
    rows: unknown[];
  }): SupplierVariantObservation[];
};

const adapters = new Map<string, SupplierObservationAdapter>();

export function registerObservationAdapter(adapter: SupplierObservationAdapter): void {
  const key = String(adapter.supplierKey)
    .trim()
    .toLowerCase();
  adapters.set(key, adapter);
}

export function getObservationAdapter(supplierKey: string): SupplierObservationAdapter | null {
  const key = String(supplierKey ?? "")
    .trim()
    .toLowerCase();
  return adapters.get(key) ?? null;
}

export function listRegisteredObservationAdapters(): string[] {
  return [...adapters.keys()].sort();
}

/**
 * Runtime check: registry says implemented AND an adapter is registered.
 * Until scrapers are wired, both stay false/empty.
 */
export function hasLiveObservationAdapter(supplierKey: string): boolean {
  const key = String(supplierKey ?? "")
    .trim()
    .toLowerCase();
  return isObservationContractImplemented(key) && adapters.has(key);
}
