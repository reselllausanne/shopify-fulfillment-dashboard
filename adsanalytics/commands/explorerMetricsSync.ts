import { resolveAdsConfig } from "@/adsanalytics/config";
import { ingestCampaignMonth, ingestProductMonth } from "@/adsanalytics/commands/backfill";
import { defaultEndDate, toIsoDate } from "@/adsanalytics/dates";
import { loadCampaignRegistry } from "@/adsanalytics/explorer/campaignRegistry";
import { loadBatchById, writeExplorerReport } from "@/adsanalytics/explorer/core";
import {
  assessMetricCoverage,
  evaluateMetricGate,
  loadMetricGateThresholds,
  syncBatchModelMetrics,
  type MetricGate,
  type MetricWindow,
} from "@/adsanalytics/explorer/metrics";
import { log, withSyncRun } from "@/adsanalytics/run";

export type ExplorerMetricsSyncOptions = {
  batch?: string;
  from?: string;
  to?: string;
  skipIngest?: boolean;
};

function requiredBatchId(batchId: string | undefined): string {
  const id = batchId?.trim();
  if (!id) throw new Error("Missing --batch=<id>");
  return id;
}

/**
 * Resolve the metric window for a batch: from activation (metrics before that cannot
 * belong to the Explorer test) to today.
 */
export function resolveBatchMetricWindow(
  activatedAt: string | null,
  options: { from?: string; to?: string } = {}
): MetricWindow {
  const end = options.to?.trim() || defaultEndDate();
  let start =
    options.from?.trim() ||
    (activatedAt ? toIsoDate(new Date(activatedAt)) : null) ||
    end;
  if (start > end) {
    // A batch activated "today" can be newer than defaultEndDate() (typically yesterday).
    // Clamp to a single-day window instead of failing the whole reconcile loop.
    start = end;
  }
  return { start, end };
}

export type ExplorerMetricsSyncResult = {
  batchId: string;
  window: MetricWindow;
  explorerCampaignId: string;
  longTailCampaignId: string | null;
  ingested: boolean;
  explorer: Awaited<ReturnType<typeof syncBatchModelMetrics>>;
  longTail: Awaited<ReturnType<typeof syncBatchModelMetrics>> | null;
  gate: MetricGate;
};

/** Reusable core so the reconciler does not shell out to another command. */
export async function runExplorerMetricsSync(
  options: ExplorerMetricsSyncOptions = {}
): Promise<ExplorerMetricsSyncResult> {
  const batchId = requiredBatchId(options.batch);
  const batch = await loadBatchById(batchId);
  if (!batch) throw new Error(`Batch not found: ${batchId}`);

  const registry = await loadCampaignRegistry();
  const explorerCampaignId =
    batch.googleCampaignId ?? registry.get("EXPLORER_ALL")?.campaignId ?? null;
  if (!explorerCampaignId) {
    throw new Error(`Batch ${batchId} has no Explorer campaign id; cannot attribute metrics`);
  }
  const longTailCampaignId = registry.get("LONG_TAIL_ALL")?.campaignId ?? null;

  const window = resolveBatchMetricWindow(batch.activatedAt, options);

  let ingested = false;
  if (options.skipIngest !== true) {
    const config = resolveAdsConfig();
    const range = { start: window.start, end: window.end };
    await ingestCampaignMonth(config, range);
    await ingestProductMonth(config, range);
    ingested = true;
    log("explorer_metrics_sync.ingested", { batchId, range });
  }

  const explorer = await syncBatchModelMetrics(batchId, explorerCampaignId, window, "explorer");
  const longTail = longTailCampaignId
    ? await syncBatchModelMetrics(batchId, longTailCampaignId, window, "long_tail")
    : null;

  const coverage = await assessMetricCoverage(explorerCampaignId, window);
  const gate = evaluateMetricGate(coverage, loadMetricGateThresholds());

  return {
    batchId,
    window,
    explorerCampaignId,
    longTailCampaignId,
    ingested,
    explorer,
    longTail,
    gate,
  };
}

export async function explorerMetricsSyncCommand(
  options: ExplorerMetricsSyncOptions = {}
): Promise<number> {
  return withSyncRun("explorer:metrics:sync", options, async () => {
    const result = await runExplorerMetricsSync(options);
    const outPath = await writeExplorerReport(
      `explorer-metrics-sync-${result.batchId}.json`,
      result
    );
    log("explorer_metrics_sync.summary", {
      batchId: result.batchId,
      window: result.window,
      explorerCampaignId: result.explorerCampaignId,
      longTailCampaignId: result.longTailCampaignId,
      modelsWithMetrics: result.explorer.modelsWithMetrics,
      totals: result.explorer.totals,
      gatePass: result.gate.pass,
      blockers: result.gate.blockers,
      warnings: result.gate.warnings,
      reportPath: outPath,
    });
    return {
      batchId: result.batchId,
      window: result.window,
      modelsWithMetrics: result.explorer.modelsWithMetrics,
      gatePass: result.gate.pass,
      blockers: result.gate.blockers,
      reportPath: outPath,
    };
  });
}
