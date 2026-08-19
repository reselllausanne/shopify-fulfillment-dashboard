import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import {
  assertHashNotRevoked,
  loadBatchById,
  loadOffersForBatchModels,
  planHashFromPayload,
  upsertOfferWrites,
  updateBatchStatus,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import { EXPLORER_ACTIVE_LABEL, EXPLORER_LABELS } from "@/adsanalytics/explorer/labels";
import { createLimiter } from "@/adsanalytics/explorer/limiter";
import {
  insertSupplementalProductLabel,
  MerchantApiError,
  type MerchantProductRef,
} from "@/adsanalytics/explorer/merchantClient";
import { ensureExplorerSupplementalSource } from "@/adsanalytics/explorer/supplementalSource";
import { log, withSyncRun } from "@/adsanalytics/run";

type ExplorerMerchantApplyOptions = {
  batch?: string;
  confirm?: string;
};

const DEFAULT_CONCURRENCY = 8;
const PROGRESS_EVERY = 100;
const PROGRESS_INTERVAL_MS = 30_000;

type OutboxRow = {
  id: string;
  offer_id: string;
  content_language: string;
  feed_label: string;
  status: string;
  attempts: number;
};

function requiredBatchId(batchId: string | undefined): string {
  const id = batchId?.trim();
  if (!id) throw new Error("Missing --batch=<id>");
  return id;
}

async function loadPendingOutboxRows(batchId: string): Promise<OutboxRow[]> {
  return prisma.$queryRaw<OutboxRow[]>(Prisma.sql`
    SELECT
      "id",
      "offer_id",
      "content_language",
      "feed_label",
      "status",
      "attempts"
    FROM "public"."ads_explorer_offer_writes"
    WHERE "batch_id" = ${batchId}
      AND "operation" = 'insert'
      AND "status" IN ('pending', 'failed')
    ORDER BY "offer_id", "content_language", "feed_label"
  `);
}

async function markOutboxSucceeded(id: string, attempts: number): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "public"."ads_explorer_offer_writes"
    SET
      "status" = 'succeeded',
      "attempts" = ${attempts + 1},
      "last_error" = NULL,
      "processed_at" = CURRENT_TIMESTAMP,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}
  `);
}

async function markOutboxFailed(id: string, attempts: number, lastError: string): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "public"."ads_explorer_offer_writes"
    SET
      "status" = 'failed',
      "attempts" = ${attempts + 1},
      "last_error" = ${lastError.slice(0, 2000)},
      "processed_at" = CURRENT_TIMESTAMP,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}
  `);
}

async function countOutboxByStatus(batchId: string): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ status: string; n: number }>>(Prisma.sql`
    SELECT "status", COUNT(*)::int AS n
    FROM "public"."ads_explorer_offer_writes"
    WHERE "batch_id" = ${batchId}
      AND "operation" = 'insert'
    GROUP BY "status"
  `);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export async function explorerMerchantApplyCommand(
  options: ExplorerMerchantApplyOptions = {}
): Promise<number> {
  return withSyncRun("explorer:merchant:apply", options, async () => {
    const batchId = requiredBatchId(options.batch);
    const confirm = options.confirm?.trim();
    if (!confirm) throw new Error("Missing --confirm=<planHash>");
    await assertHashNotRevoked(confirm);
    const batch = await loadBatchById(batchId);
    if (!batch) throw new Error(`Batch not found: ${batchId}`);
    if (["failed", "rolled_back", "completed"].includes(batch.status)) {
      throw new Error(`Batch ${batchId} status ${batch.status} is not apply-eligible`);
    }

    const offers = await loadOffersForBatchModels(batchId);
    if (offers.length === 0) throw new Error(`No offers found for batch ${batchId}`);
    const writes = offers.map((o) => ({
      shopifyProductId: o.shopifyProductId,
      offerId: o.offerId,
      languageCode: o.languageCode,
      feedLabel: o.feedLabel,
      operation: "insert" as const,
    }));
    const expectedHash = planHashFromPayload({
      batchId,
      operation: "insert",
      writes: writes.map((w) => ({
        product: w.shopifyProductId,
        offerId: w.offerId,
        lang: w.languageCode,
        feed: w.feedLabel,
      })),
    });
    if (confirm !== expectedHash) {
      throw new Error(`Confirm hash mismatch. Expected ${expectedHash}, got ${confirm}`);
    }

    await upsertOfferWrites(batchId, writes);
    const merchantId = offers[0]!.merchantId;
    const { dataSource, sourceCreated, primaryPatches } = await ensureExplorerSupplementalSource(merchantId);

    const stats = (batch.statsJson ?? {}) as Record<string, unknown>;
    const rawLabel = typeof stats.explorerLabel === "string" ? stats.explorerLabel.trim() : "";
    const explorerLabel =
      rawLabel && (EXPLORER_LABELS as readonly string[]).includes(rawLabel)
        ? rawLabel
        : EXPLORER_ACTIVE_LABEL;

    const pendingRows = await loadPendingOutboxRows(batchId);
    const limit = createLimiter(DEFAULT_CONCURRENCY);
    let processed = 0;
    let succeededNow = 0;
    let failedNow = 0;
    let lastProgressAt = Date.now();

    log("explorer_merchant_apply.start", {
      batchId,
      expectedHash,
      merchantId,
      dataSource,
      sourceCreated,
      explorerLabel,
      primaryPatchedCount: primaryPatches.filter((x) => x.patched).length,
      pendingCount: pendingRows.length,
      concurrency: DEFAULT_CONCURRENCY,
    });

    await Promise.all(
      pendingRows.map((row) =>
        limit(async () => {
          const product: MerchantProductRef = {
            offerId: row.offer_id,
            contentLanguage: row.content_language,
            feedLabel: row.feed_label,
          };
          try {
            await insertSupplementalProductLabel(
              merchantId,
              dataSource,
              product,
              explorerLabel
            );
            await markOutboxSucceeded(row.id, row.attempts);
            succeededNow += 1;
          } catch (err) {
            const message =
              err instanceof MerchantApiError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : String(err);
            await markOutboxFailed(row.id, row.attempts, message);
            failedNow += 1;
          } finally {
            processed += 1;
            const now = Date.now();
            if (
              processed % PROGRESS_EVERY === 0 ||
              processed === pendingRows.length ||
              now - lastProgressAt >= PROGRESS_INTERVAL_MS
            ) {
              lastProgressAt = now;
              log("explorer_merchant_apply.progress", {
                batchId,
                processed,
                total: pendingRows.length,
                succeededNow,
                failedNow,
              });
            }
          }
        })
      )
    );

    const byStatus = await countOutboxByStatus(batchId);
    const pending = Number(byStatus.pending ?? 0);
    const succeeded = Number(byStatus.succeeded ?? 0);
    const failed = Number(byStatus.failed ?? 0);
    const total = pending + succeeded + failed;

    await updateBatchStatus(batchId, "labeling", {
      statsJson: {
        merchantApplyAt: new Date().toISOString(),
        writePlanHash: expectedHash,
        writeCount: writes.length,
        liveApplied: true,
        dataSource,
        sourceCreated,
        primaryPatchedCount: primaryPatches.filter((x) => x.patched).length,
        outbox: { total, pending, succeeded, failed },
      },
      error: null,
    });

    const report = {
      batchId,
      expectedHash,
      confirmedHash: confirm,
      merchantId,
      dataSource,
      sourceCreated,
      primaryPatches,
      writesPrepared: writes.length,
      liveApplied: true,
      processedThisRun: pendingRows.length,
      succeededThisRun: succeededNow,
      failedThisRun: failedNow,
      outbox: { total, pending, succeeded, failed, byStatus },
    };
    const outPath = await writeExplorerReport(`explorer-merchant-apply-${batchId}.json`, report);
    log("explorer_merchant_apply.summary", {
      batchId,
      expectedHash,
      writesPrepared: writes.length,
      liveApplied: true,
      total,
      pending,
      succeeded,
      failed,
      reportPath: outPath,
    });
    return {
      batchId,
      expectedHash,
      writesPrepared: writes.length,
      liveApplied: true,
      total,
      pending,
      succeeded,
      failed,
      reportPath: outPath,
    };
  });
}
