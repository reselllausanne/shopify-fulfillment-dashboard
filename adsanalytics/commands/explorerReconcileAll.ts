import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { authHealthCommand } from "@/adsanalytics/commands/authHealth";
import {
  explorerReconcileCommand,
  type ExplorerReconcileOptions,
} from "@/adsanalytics/commands/explorerReconcile";
import { writeExplorerReport } from "@/adsanalytics/explorer/core";
import { EXIT_OK, log, logError, withSyncRun } from "@/adsanalytics/run";

type ActiveBatchRow = {
  id: string;
  status: string;
  activated_at: string | null;
};

async function loadActiveBatches(): Promise<ActiveBatchRow[]> {
  return prisma.$queryRaw<ActiveBatchRow[]>(Prisma.sql`
    SELECT "id", "status", "activated_at"::text
    FROM "public"."ads_explorer_batches"
    WHERE "status" = 'active'
    ORDER BY "activated_at" ASC NULLS LAST, "created_at" ASC
  `);
}

export async function explorerReconcileAllCommand(
  options: Omit<ExplorerReconcileOptions, "batch"> = {}
): Promise<number> {
  return withSyncRun("explorer:reconcile:all", options, async () => {
    const authExit = await authHealthCommand();
    if (authExit !== EXIT_OK) {
      throw new Error(`auth:health exited with code ${authExit}`);
    }

    const activeBatches = await loadActiveBatches();
    if (activeBatches.length === 0) {
      log("explorer_reconcile_all.skip", { reason: "no_active_batches" });
      return { skipped: true, reason: "no_active_batches", batches: 0 };
    }

    const results: Array<{ batchId: string; ok: boolean; error?: string }> = [];
    for (const batch of activeBatches) {
      try {
        const exit = await explorerReconcileCommand({
          batch: batch.id,
          dryRun: options.dryRun,
          skipIngest: options.skipIngest,
          maxTransitions: options.maxTransitions,
          force: options.force,
        });
        if (exit !== EXIT_OK) {
          throw new Error(`explorer:reconcile exited with code ${exit}`);
        }
        results.push({ batchId: batch.id, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError("explorer_reconcile_all.batch_failed", { batchId: batch.id, message });
        results.push({ batchId: batch.id, ok: false, error: message });
      }
    }

    const failed = results.filter((r) => !r.ok);
    const reportPath = await writeExplorerReport("explorer-reconcile-all.json", {
      checkedAt: new Date().toISOString(),
      options,
      activeBatchIds: activeBatches.map((b) => b.id),
      results,
      failedCount: failed.length,
    });
    log("explorer_reconcile_all.summary", {
      batches: activeBatches.length,
      failed: failed.length,
      reportPath,
    });

    if (failed.length > 0) {
      throw new Error(
        `reconcile failed for ${failed.length} batch(es): ${failed
          .map((r) => `${r.batchId}: ${r.error}`)
          .join(" | ")}`
      );
    }
    return {
      batches: activeBatches.length,
      failed: 0,
      reportPath,
    };
  });
}
