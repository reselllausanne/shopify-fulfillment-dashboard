import { finalizeSupplierStockRun } from "./applyRun";
import type { FinalizeRunResult } from "./applyRun";

/**
 * Called after a scrape run finishes — reads scraper.scrape_runs via finalizeSupplierStockRun.
 */
export async function finalizeSupplierStockFromScrapeRun(
  supplierKey: string,
  scrapeRunId: number,
  opts?: { dryRun?: boolean; priorActiveCatalog?: number }
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
      variantsProcessed: 0,
      qtyZeroed: 0,
      reviewItemsCreated: 0,
      policyStatus: "review_required",
      paused: false,
    };
  }

  try {
    return await finalizeSupplierStockRun({
      supplierKey: key,
      scrapeRunId: runId,
      dryRun: opts?.dryRun,
      priorActiveCatalog: opts?.priorActiveCatalog,
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
      invalidReason: message.slice(0, 200),
      completeSnapshot: false,
      variantsProcessed: 0,
      qtyZeroed: 0,
      reviewItemsCreated: 0,
      policyStatus: "review_required",
      paused: false,
    };
  }
}
