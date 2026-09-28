/**
 * Per-supplier observation buffer for scrape runs.
 * Scrapers push during crawl; scraperRunner drains after scrape completes.
 */

import type { SupplierVariantObservation } from "./types";

type BufferKey = string;

const buffers = new Map<BufferKey, SupplierVariantObservation[]>();

function key(supplierKey: string, scrapeRunId: number): BufferKey {
  return `${String(supplierKey).trim().toLowerCase()}:${scrapeRunId}`;
}

export function beginSupplierObservationRun(supplierKey: string, scrapeRunId: number): void {
  buffers.set(key(supplierKey, scrapeRunId), []);
}

export function pushSupplierObservation(obs: SupplierVariantObservation): void {
  const k = key(obs.supplierKey, obs.scrapeRunId);
  const list = buffers.get(k);
  if (list) list.push(obs);
  else buffers.set(k, [obs]);
}

export function drainSupplierObservations(
  supplierKey: string,
  scrapeRunId: number
): SupplierVariantObservation[] {
  const k = key(supplierKey, scrapeRunId);
  const list = buffers.get(k) ?? [];
  buffers.delete(k);
  return list;
}

/** Aliases used by scraperRunner. */
export const beginObservationRun = beginSupplierObservationRun;
export const pushObservation = (
  supplierKey: string,
  scrapeRunId: number,
  obs: SupplierVariantObservation
): void => {
  const k = key(supplierKey, scrapeRunId);
  const list = buffers.get(k);
  if (list) list.push(obs);
  else buffers.set(k, [obs]);
};
export const drainObservations = drainSupplierObservations;

/** Test helper — clear all buffers. */
export function clearObservationBuffers(): void {
  buffers.clear();
}
