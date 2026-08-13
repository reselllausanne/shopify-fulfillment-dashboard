import {
  EXPLORER_OPS_DAILY_LIMIT,
  estimateListingMutationOps,
  loadBatchById,
  loadBatchModelRows,
  loadExplorerCampaignsAndListingNodes,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import { log, withSyncRun } from "@/adsanalytics/run";

type ExplorerPreflightOptions = { batch?: string };

function requiredBatchId(batchId: string | undefined): string {
  const id = batchId?.trim();
  if (!id) throw new Error("Missing --batch=<id>");
  return id;
}

export async function explorerPreflightCommand(
  options: ExplorerPreflightOptions = {}
): Promise<number> {
  return withSyncRun("explorer:preflight", options, async () => {
    const batchId = requiredBatchId(options.batch);
    const [batch, models, listingCtx] = await Promise.all([
      loadBatchById(batchId),
      loadBatchModelRows(batchId),
      loadExplorerCampaignsAndListingNodes(),
    ]);
    if (!batch) throw new Error(`Batch not found: ${batchId}`);

    const modelCountDb = models.length;
    const statusOk = batch.status === "planned" || batch.status === "labeling" || batch.status === "ready";
    const listingEstimate = estimateListingMutationOps(listingCtx.listingNodes);

    const blockers: string[] = [];
    if (!statusOk) blockers.push(`Batch status ${batch.status} not preflight-compatible`);
    if (modelCountDb === 0) blockers.push("Batch has zero models");
    if (listingEstimate.estimatedOperations > 2000) {
      blockers.push(
        `Estimated listing operations ${listingEstimate.estimatedOperations} exceed safety cap 2000`
      );
    }

    const report = {
      batchId,
      batch,
      preflight: {
        statusOk,
        modelCountDb,
        listingEstimate,
        opsDailyLimit: EXPLORER_OPS_DAILY_LIMIT,
      },
      blockers,
      pass: blockers.length === 0,
    };
    const outPath = await writeExplorerReport(`explorer-preflight-${batchId}.json`, report);
    log("explorer_preflight.summary", {
      batchId,
      pass: blockers.length === 0,
      blockers,
      modelCountDb,
      listingOps: listingEstimate.estimatedOperations,
      reportPath: outPath,
    });
    return {
      batchId,
      pass: blockers.length === 0,
      blockers,
      modelCountDb,
      listingOps: listingEstimate.estimatedOperations,
      reportPath: outPath,
    };
  });
}

