import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { runExplorerMetricsSync } from "@/adsanalytics/commands/explorerMetricsSync";
import {
  EXPLORER_DEFAULT_MERCHANT_ID,
  loadBatchById,
  updateBatchStatus,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import {
  isDestination,
  loadOffersForBatchGroupedByModel,
  setModelDestination,
  verifyPendingDestinations,
  type Destination,
  type DestinationContext,
  type SetModelDestinationResult,
} from "@/adsanalytics/explorer/destinations";
import { ensureExplorerSupplementalSource } from "@/adsanalytics/explorer/supplementalSource";
import {
  decideBatchClosure,
  decideDestination,
  loadExplorerRuleConfig,
  type ExplorerRuleConfig,
  type ModelRuleInput,
  type RuleDecision,
} from "@/adsanalytics/explorer/rules";
import { log, logError, withSyncRun } from "@/adsanalytics/run";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ExplorerReconcileOptions = {
  batch?: string;
  dryRun?: boolean;
  skipIngest?: boolean;
  maxTransitions?: number;
  force?: boolean;
};

type ModelRow = {
  shopify_product_id: string;
  destination: string;
  pending_destination: string | null;
  impressions: number;
  clicks: number;
  conversions: number;
  lt_conversions: number;
};

function requiredBatchId(batchId: string | undefined): string {
  const id = batchId?.trim();
  if (!id) throw new Error("Missing --batch=<id>");
  return id;
}

async function loadModelsForDecision(batchId: string): Promise<ModelRow[]> {
  return prisma.$queryRaw<ModelRow[]>(Prisma.sql`
    SELECT
      "shopify_product_id"::text,
      "destination",
      "pending_destination",
      COALESCE("impressions", 0)::float8 AS impressions,
      COALESCE("clicks", 0)::float8 AS clicks,
      COALESCE("conversions", 0)::float8 AS conversions,
      COALESCE("lt_conversions", 0)::float8 AS lt_conversions
    FROM "public"."ads_explorer_batch_models"
    WHERE "batch_id" = ${batchId}
    ORDER BY "shopify_product_id"
  `);
}

function elapsedDaysSince(activatedAt: string | null, now: Date): number {
  if (!activatedAt) return 0;
  return (now.getTime() - new Date(activatedAt).getTime()) / 86_400_000;
}

function toRuleInput(row: ModelRow, elapsedDays: number): ModelRuleInput {
  const destination: Destination = isDestination(row.destination) ? row.destination : "EXPLORER_ALL";
  return {
    modelId: row.shopify_product_id,
    destination,
    impressions: row.impressions,
    clicks: row.clicks,
    conversions: row.conversions,
    ltConversions: row.lt_conversions,
    elapsedDays,
  };
}

export function planReconcileDecisions(
  rows: ModelRow[],
  config: ExplorerRuleConfig,
  elapsedDays: number,
  now: Date
): RuleDecision[] {
  const decisions: RuleDecision[] = [];
  for (const row of rows) {
    const input = toRuleInput(row, elapsedDays);
    const decision = decideDestination(input, config, now) ?? decideBatchClosure(input, config, now);
    if (!decision) continue;
    if (decision.destination === input.destination) continue;
    decisions.push(decision);
  }
  return decisions;
}

/**
 * Single scheduled entry point: metric sync -> decision -> Merchant mutation -> readback
 * -> DB commit. Nothing transitions in the database until Merchant confirms the label,
 * so a failed run simply leaves work for the next one.
 */
export async function explorerReconcileCommand(
  options: ExplorerReconcileOptions = {}
): Promise<number> {
  return withSyncRun("explorer:reconcile", options, async () => {
    const batchId = requiredBatchId(options.batch);
    const dryRun = options.dryRun === true;
    const now = new Date();

    const batch = await loadBatchById(batchId);
    if (!batch) throw new Error(`Batch not found: ${batchId}`);
    if (["failed", "rolled_back"].includes(batch.status)) {
      throw new Error(`Batch ${batchId} status ${batch.status} is not reconcilable`);
    }

    // 1. Metric sync. Offer grain first, then the model rollup the rules read.
    const metrics = await runExplorerMetricsSync({ batch: batchId, skipIngest: options.skipIngest });
    const gate = metrics.gate;
    if (!gate.pass && options.force !== true) {
      const report = {
        batchId,
        stage: "metric_gate",
        gate,
        note: "No decision taken: metric coverage gate failed. Fix ingestion or pass --force.",
      };
      const blockedPath = await writeExplorerReport(`explorer-reconcile-${batchId}.json`, report);
      logError("explorer_reconcile.metric_gate_failed", {
        batchId,
        blockers: gate.blockers,
        reportPath: blockedPath,
      });
      throw new Error(`Metric gate failed: ${gate.blockers.join(" | ")}`);
    }

    const config = loadExplorerRuleConfig();
    const elapsedDays = elapsedDaysSince(batch.activatedAt, now);

    const ctx: DestinationContext = {
      batchId,
      merchantId: EXPLORER_DEFAULT_MERCHANT_ID,
      dataSource: "",
      dryRun,
    };

    // 2. Resume: models mutated in an earlier run whose readback had not propagated.
    let pendingResume: Awaited<ReturnType<typeof verifyPendingDestinations>> | null = null;

    if (!dryRun) {
      const { dataSource } = await ensureExplorerSupplementalSource(ctx.merchantId);
      ctx.dataSource = dataSource;
      pendingResume = await verifyPendingDestinations(ctx);
      log("explorer_reconcile.pending_resume", {
        batchId,
        checked: pendingResume.checked,
        committed: pendingResume.committed,
        stillPending: pendingResume.stillPending,
      });
    }

    // 3. Decide, on data that just passed the gate.
    const rows = await loadModelsForDecision(batchId);
    const allDecisions = planReconcileDecisions(rows, config, elapsedDays, now);
    const maxTransitions = options.maxTransitions ?? allDecisions.length;
    const decisions = allDecisions.slice(0, maxTransitions);

    const byReason = allDecisions.reduce<Record<string, number>>((acc, d) => {
      acc[d.reason] = (acc[d.reason] ?? 0) + 1;
      return acc;
    }, {});
    const byDestination = allDecisions.reduce<Record<string, number>>((acc, d) => {
      acc[d.destination] = (acc[d.destination] ?? 0) + 1;
      return acc;
    }, {});

    const pendingByModel = new Map(
      rows.map((r) => [r.shopify_product_id, r.pending_destination] as const)
    );

    // 4. Merchant mutation + short readback. Unconfirmed models stay pending; we do not
    // sit 2 minutes per model waiting for Merchant. A poll at the end of this run commits
    // whatever has propagated.
    const results: SetModelDestinationResult[] = [];
    const failures: Array<{ modelId: string; destination: Destination; errors: string[] }> = [];

    if (!dryRun && decisions.length > 0) {
      const offersByModel = await loadOffersForBatchGroupedByModel(batchId);
      let attempted = 0;
      for (const decision of decisions) {
        if (pendingByModel.get(decision.modelId) === decision.destination) {
          continue;
        }
        attempted += 1;
        try {
          const result = await setModelDestination(decision.modelId, decision.destination, ctx, {
            reason: decision.reason,
            retestAt: decision.retestAt,
            cooldownUntil: decision.cooldownUntil,
            offers: offersByModel.get(decision.modelId),
          });
          results.push(result);
          if (!result.committed) {
            failures.push({
              modelId: decision.modelId,
              destination: decision.destination,
              errors:
                result.mutationErrors.length > 0
                  ? result.mutationErrors
                  : ["Merchant readback not converged; will retry next run"],
            });
          }
          if (attempted === 1 || attempted % 10 === 0 || attempted === decisions.length) {
            log("explorer_reconcile.progress", {
              batchId,
              attempted,
              of: decisions.length,
              planned: allDecisions.length,
              committed: results.filter((r) => r.committed).length,
              failures: failures.length,
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failures.push({ modelId: decision.modelId, destination: decision.destination, errors: [message] });
          logError("explorer_reconcile.transition_failed", {
            batchId,
            modelId: decision.modelId,
            destination: decision.destination,
            message,
          });
        }
      }

      const pendingAfterMutate = failures.filter((f) =>
        f.errors.some((e) => e.includes("not converged"))
      ).length;
      if (pendingAfterMutate > 0) {
        for (let round = 1; round <= 8; round += 1) {
          await sleep(45_000);
          const poll = await verifyPendingDestinations(ctx);
          log("explorer_reconcile.pending_poll", {
            batchId,
            round,
            checked: poll.checked,
            committed: poll.committed,
            stillPending: poll.stillPending,
          });
          if (poll.stillPending === 0) break;
        }
      }
    }

    // 5. Batch closure guarantee: nothing may stay explorer_active past the window.
    const after = await loadModelsForDecision(batchId);
    const stillExplorer = after.filter((r) => r.destination === "EXPLORER_ALL").length;
    const stillPending = after.filter((r) => r.pending_destination != null).length;
    const batchClosed = elapsedDays >= config.batchDays;
    const closureClean = !batchClosed || stillExplorer === 0;

    if (!dryRun && batchClosed && closureClean && stillPending === 0 && batch.status !== "completed") {
      await updateBatchStatus(batchId, "completed", {
        statsJson: { completedAt: new Date().toISOString(), closureReason: "all_models_routed" },
        error: null,
      });
    }

    const report = {
      batchId,
      dryRun,
      now: now.toISOString(),
      elapsedDays,
      ruleConfig: config,
      metrics: {
        window: metrics.window,
        explorerCampaignId: metrics.explorerCampaignId,
        longTailCampaignId: metrics.longTailCampaignId,
        modelsWithMetrics: metrics.explorer.modelsWithMetrics,
        totals: metrics.explorer.totals,
      },
      gate,
      pendingResume,
      modelsConsidered: rows.length,
      decisionsPlanned: allDecisions.length,
      decisionsAttempted: decisions.length,
      byReason,
      byDestination,
      committed: results.filter((r) => r.committed).length,
      failures,
      closure: {
        batchClosed,
        stillExplorer,
        stillPending,
        closureClean,
      },
      decisionSamples: allDecisions.slice(0, 100),
    };
    const outPath = await writeExplorerReport(`explorer-reconcile-${batchId}.json`, report);
    log("explorer_reconcile.summary", {
      batchId,
      dryRun,
      elapsedDays,
      gatePass: gate.pass,
      modelsConsidered: rows.length,
      decisionsPlanned: allDecisions.length,
      committed: report.committed,
      failures: failures.length,
      byReason,
      byDestination,
      stillExplorer,
      stillPending,
      reportPath: outPath,
    });

    if (failures.length > 0) {
      // Transitions are idempotent: the next run re-reads Merchant and resumes.
      logError("explorer_reconcile.retry_pending", { batchId, failures: failures.length });
    }
    if (batchClosed && !closureClean) {
      logError("explorer_reconcile.closure_violation", { batchId, stillExplorer });
    }

    return {
      batchId,
      dryRun,
      gatePass: gate.pass,
      modelsConsidered: rows.length,
      decisionsPlanned: allDecisions.length,
      committed: report.committed,
      failures: failures.length,
      stillExplorer,
      reportPath: outPath,
    };
  });
}
