import { finalizeSupplierStockRun } from "./applyRun";
import type { FinalizeRunResult } from "./applyRun";
import type { SnapshotCompleteness, SupplierVariantObservation } from "./types";

/**
 * Called after a scrape run finishes — reads scraper.scrape_runs via finalizeSupplierStockRun.
 * Optional structured observations renew proof; without them publishedQty stays 0.
 */
export async function finalizeSupplierStockFromScrapeRun(
  supplierKey: string,
  scrapeRunId: number,
  opts?: {
    dryRun?: boolean;
    priorActiveCatalog?: number;
    observations?: SupplierVariantObservation[];
    snapshotCompleteness?: SnapshotCompleteness;
    incompletenessReason?: string | null;
    partialRun?: boolean;
  }
): Promise<FinalizeRunResult> {
  const key = String(supplierKey ?? "").trim().toLowerCase();
  const runId = Number(scrapeRunId);
  if (!key || !Number.isFinite(runId) || runId <= 0) {
    return {
      ok: false,
      dryRun: Boolean(opts?.dryRun),
      supplierKey: key,
      scrapeRunId: runId,
      valid: false,
      invalidReason: "invalid_arguments",
      completeSnapshot: false,
      snapshotCompleteness: "unknown",
      variantsProcessed: 0,
      qtyZeroed: 0,
      reviewItemsCreated: 0,
      policyStatus: "review_required",
      paused: false,
      observationContractPresent: false,
    };
  }

  try {
    return await finalizeSupplierStockRun({
      supplierKey: key,
      scrapeRunId: runId,
      dryRun: opts?.dryRun,
      priorActiveCatalog: opts?.priorActiveCatalog,
      observations: opts?.observations,
      snapshotCompleteness: opts?.snapshotCompleteness,
      incompletenessReason: opts?.incompletenessReason,
      partialRun: opts?.partialRun ?? Boolean(opts?.snapshotCompleteness === "partial"),
    });
  } catch (error: unknown) {
    const message = String((error as Error)?.message ?? error);
    console.error(`[supplierStock] finalize failed ${key} run#${runId}:`, message.slice(0, 500));
    return {
      ok: false,
      dryRun: Boolean(opts?.dryRun),
      supplierKey: key,
      scrapeRunId: runId,
      valid: false,
      invalidReason: `finalize_exception:${message.slice(0, 120)}`,
      completeSnapshot: false,
      snapshotCompleteness: "unknown",
      variantsProcessed: 0,
      qtyZeroed: 0,
      reviewItemsCreated: 0,
      policyStatus: "review_required",
      paused: false,
      observationContractPresent: Boolean(opts?.observations?.length),
    };
  }
}
