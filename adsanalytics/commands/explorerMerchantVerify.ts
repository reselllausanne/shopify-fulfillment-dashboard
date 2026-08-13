import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import {
  loadBatchById,
  loadEligibleInStockOffersForBatchModels,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import { EXPLORER_ACTIVE_LABEL as EXPLORER_LABEL } from "@/adsanalytics/explorer/labels";
import {
  extractCustomLabel3,
  getProcessedProduct,
  MerchantApiError,
  type MerchantProductRef,
} from "@/adsanalytics/explorer/merchantClient";
import { log, withSyncRun } from "@/adsanalytics/run";

type ExplorerMerchantVerifyOptions = { batch?: string };

const DEFAULT_CONCURRENCY = 8;
const PROGRESS_EVERY = 500;
const PROGRESS_INTERVAL_MS = 30_000;
const MISMATCH_SAMPLE_LIMIT = 25;

function requiredBatchId(batchId: string | undefined): string {
  const id = batchId?.trim();
  if (!id) throw new Error("Missing --batch=<id>");
  return id;
}

function createLimiter(concurrency: number) {
  const limit = Math.max(1, concurrency);
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= limit) return;
    const job = queue.shift();
    if (!job) return;
    active += 1;
    job();
  };
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            next();
          });
      });
      next();
    });
  };
}

export async function explorerMerchantVerifyCommand(
  options: ExplorerMerchantVerifyOptions = {}
): Promise<number> {
  return withSyncRun("explorer:merchant:verify", options, async () => {
    const batchId = requiredBatchId(options.batch);
    const batch = await loadBatchById(batchId);
    if (!batch) throw new Error(`Batch not found: ${batchId}`);

    const outboxRows = await prisma.$queryRaw<Array<{ status: string; n: number }>>(Prisma.sql`
      SELECT "status", COUNT(*)::int AS n
      FROM "public"."ads_explorer_offer_writes"
      WHERE "batch_id" = ${batchId}
        AND "operation" = 'insert'
      GROUP BY "status"
      ORDER BY "status"
    `);
    const byStatus = Object.fromEntries(outboxRows.map((r) => [r.status, r.n]));
    const pending = Number(byStatus.pending ?? 0);
    const succeeded = Number(byStatus.succeeded ?? 0);
    const failed = Number(byStatus.failed ?? 0);
    const outboxTotal = pending + succeeded + failed;
    const pendingPct = outboxTotal > 0 ? Number(((pending / outboxTotal) * 100).toFixed(4)) : 100;
    const outboxGatePass = pendingPct <= 1;

    const offers = await loadEligibleInStockOffersForBatchModels(batchId);
    if (offers.length === 0) throw new Error(`No ELIGIBLE+IN_STOCK offers for batch ${batchId}`);
    const merchantId = offers[0]!.merchantId;

    const limit = createLimiter(DEFAULT_CONCURRENCY);
    let checked = 0;
    let labeled = 0;
    let fetchErrors = 0;
    let lastProgressAt = Date.now();
    const mismatches: Array<{
      offerId: string;
      contentLanguage: string;
      feedLabel: string;
      observed: string | null;
      error?: string;
    }> = [];

    log("explorer_merchant_verify.start", {
      batchId,
      merchantId,
      eligibleInStockCount: offers.length,
      outboxTotal,
      pending,
      concurrency: DEFAULT_CONCURRENCY,
    });

    await Promise.all(
      offers.map((offer) =>
        limit(async () => {
          const product: MerchantProductRef = {
            offerId: offer.offerId,
            contentLanguage: offer.languageCode,
            feedLabel: offer.feedLabel,
          };
          try {
            const processed = await getProcessedProduct(merchantId, product);
            const observed = extractCustomLabel3(processed);
            if (observed === EXPLORER_LABEL) {
              labeled += 1;
            } else if (mismatches.length < MISMATCH_SAMPLE_LIMIT) {
              mismatches.push({
                offerId: offer.offerId,
                contentLanguage: offer.languageCode,
                feedLabel: offer.feedLabel,
                observed,
              });
            }
          } catch (err) {
            fetchErrors += 1;
            if (mismatches.length < MISMATCH_SAMPLE_LIMIT) {
              const message =
                err instanceof MerchantApiError
                  ? err.message
                  : err instanceof Error
                    ? err.message
                    : String(err);
              mismatches.push({
                offerId: offer.offerId,
                contentLanguage: offer.languageCode,
                feedLabel: offer.feedLabel,
                observed: null,
                error: message,
              });
            }
          } finally {
            checked += 1;
            const now = Date.now();
            if (
              checked % PROGRESS_EVERY === 0 ||
              checked === offers.length ||
              now - lastProgressAt >= PROGRESS_INTERVAL_MS
            ) {
              lastProgressAt = now;
              log("explorer_merchant_verify.progress", {
                batchId,
                checked,
                total: offers.length,
                labeled,
                fetchErrors,
              });
            }
          }
        })
      )
    );

    const eligibleTotal = offers.length;
    const eligibleLabeled = labeled;
    const eligibleMissing = eligibleTotal - eligibleLabeled - fetchErrors;
    const eligibleGatePass = eligibleLabeled === eligibleTotal;
    const pass = eligibleGatePass && outboxGatePass;

    const report = {
      batchId,
      batchStatus: batch.status,
      merchantId,
      eligibleGate: {
        pass: eligibleGatePass,
        thresholdPct: 100,
        total: eligibleTotal,
        labeled: eligibleLabeled,
        missing: eligibleMissing,
        fetchErrors,
        expectedLabel: EXPLORER_LABEL,
        mismatchSamples: mismatches,
      },
      outbox: {
        total: outboxTotal,
        byStatus,
        pending,
        succeeded,
        failed,
        pendingPct,
        gatePass: outboxGatePass,
        thresholdPct: 1,
      },
      activationGate: {
        pass,
        eligibleGatePass,
        outboxGatePass,
        reason: pass
          ? "All ELIGIBLE+IN_STOCK offers labeled explorer_active and outbox pending <=1%"
          : !eligibleGatePass
            ? "Not all ELIGIBLE+IN_STOCK offers show explorer_active in processed products"
            : "Outbox pending inserts >1%",
      },
    };
    const outPath = await writeExplorerReport(`explorer-merchant-verify-${batchId}.json`, report);
    log("explorer_merchant_verify.summary", {
      batchId,
      eligibleTotal,
      eligibleLabeled,
      eligibleMissing,
      fetchErrors,
      outboxTotal,
      pending,
      succeeded,
      failed,
      pendingPct,
      pass,
      reportPath: outPath,
    });
    return {
      batchId,
      eligibleTotal,
      eligibleLabeled,
      eligibleMissing,
      fetchErrors,
      outboxTotal,
      pending,
      succeeded,
      failed,
      pendingPct,
      pass,
      reportPath: outPath,
    };
  });
}
