import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import {
  assertHashNotRevoked,
  loadBatchById,
  planHashFromPayload,
  updateBatchStatus,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import { log, withSyncRun } from "@/adsanalytics/run";

type ExplorerRollbackOptions = { batch?: string; confirm?: string };

function requiredBatchId(batchId: string | undefined): string {
  const id = batchId?.trim();
  if (!id) throw new Error("Missing --batch=<id>");
  return id;
}

export async function explorerRollbackCommand(options: ExplorerRollbackOptions = {}): Promise<number> {
  return withSyncRun("explorer:rollback", options, async () => {
    const batchId = requiredBatchId(options.batch);
    const batch = await loadBatchById(batchId);
    if (!batch) throw new Error(`Batch not found: ${batchId}`);
    const rollbackPlan = {
      batchId,
      actions: [
        "pause_explorer_campaign",
        "delete_explorer_productinputs",
        "restore_listing_trees_from_backup",
        "run_post_rollback_checks",
      ],
    };
    const planHash = planHashFromPayload(rollbackPlan);
    const confirm = options.confirm?.trim();
    if (!confirm) throw new Error("Missing --confirm=<planHash>");
    await assertHashNotRevoked(confirm);
    if (confirm !== planHash) {
      throw new Error(`Confirm hash mismatch. Expected ${planHash}, got ${confirm}`);
    }

    // Live rollback intentionally blocked in this phase. Persist safe state markers only.
    await updateBatchStatus(batchId, "rolled_back", {
      statsJson: {
        rollbackPlanHash: planHash,
        rolledBackAt: new Date().toISOString(),
        liveApplied: false,
        blocker: "Live rollback calls disabled; only DB rollback state persisted.",
      },
    });
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "public"."ads_explorer_offer_writes"
      SET
        "status" = CASE WHEN "status" = 'pending' THEN 'failed' ELSE "status" END,
        "last_error" = CASE WHEN "status" = 'pending' THEN 'rolled_back_before_live_apply' ELSE "last_error" END,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "batch_id" = ${batchId}
    `);

    const report = {
      batchId,
      planHash,
      confirmedHash: confirm,
      liveApplied: false,
      actions: rollbackPlan.actions,
    };
    const outPath = await writeExplorerReport(`explorer-rollback-${batchId}.json`, report);
    log("explorer_rollback.summary", {
      batchId,
      planHash,
      liveApplied: false,
      reportPath: outPath,
    });
    return { batchId, planHash, liveApplied: false, reportPath: outPath };
  });
}

