import {
  loadBatchById,
  loadOffersForBatchModels,
  planHashFromPayload,
  upsertOfferWrites,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import { log, withSyncRun } from "@/adsanalytics/run";

type ExplorerMerchantPrepareOptions = {
  batch?: string;
  dryRun?: boolean;
};

function requiredBatchId(batchId: string | undefined): string {
  const id = batchId?.trim();
  if (!id) throw new Error("Missing --batch=<id>");
  return id;
}

export async function explorerMerchantPrepareCommand(
  options: ExplorerMerchantPrepareOptions = {}
): Promise<number> {
  return withSyncRun("explorer:merchant:prepare", options, async () => {
    const batchId = requiredBatchId(options.batch);
    const dryRun = options.dryRun !== false;
    const batch = await loadBatchById(batchId);
    if (!batch) throw new Error(`Batch not found: ${batchId}`);

    const offers = await loadOffersForBatchModels(batchId);
    const writes = offers.map((o) => ({
      shopifyProductId: o.shopifyProductId,
      offerId: o.offerId,
      languageCode: o.languageCode,
      feedLabel: o.feedLabel,
      operation: "insert" as const,
    }));
    const writePlanHash = planHashFromPayload({
      batchId,
      operation: "insert",
      writes: writes.map((w) => ({
        product: w.shopifyProductId,
        offerId: w.offerId,
        lang: w.languageCode,
        feed: w.feedLabel,
      })),
    });

    if (!dryRun) {
      await upsertOfferWrites(batchId, writes);
    }

    const report = {
      batchId,
      dryRun,
      batchPlanHash: batch.planHash,
      writePlanHash,
      writeCount: writes.length,
      distinctModels: new Set(writes.map((w) => w.shopifyProductId)).size,
      writesPreview: writes.slice(0, 200),
      note:
        "Dry-run only prepares deterministic outbox payload. No Merchant write performed unless explicit apply command with matching plan hash.",
    };
    const outPath = await writeExplorerReport(`explorer-merchant-prepare-${batchId}.json`, report);
    log("explorer_merchant_prepare.summary", {
      batchId,
      dryRun,
      writeCount: writes.length,
      writePlanHash,
      reportPath: outPath,
    });
    return {
      batchId,
      dryRun,
      writePlanHash,
      writeCount: writes.length,
      reportPath: outPath,
    };
  });
}

