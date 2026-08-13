import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import {
  assertHashNotRevoked,
  EXPLORER_DEFAULT_BATCH_DAYS,
  expectedBatchEndFromNow,
  loadBatchById,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import { resolveAdsConfig } from "@/adsanalytics/config";
import { searchAll } from "@/adsanalytics/google/adsClient";
import {
  enableExplorerAdGroupAd,
  enableExplorerAdGroup,
  enableExplorerCampaign,
  verifyPurchasePrimaryConversion,
} from "@/adsanalytics/google/explorerCampaignMutations";
import { log, withSyncRun } from "@/adsanalytics/run";

type ExplorerActivateOptions = { batch?: string; confirm?: string };

function requiredBatchId(batchId: string | undefined): string {
  const id = batchId?.trim();
  if (!id) throw new Error("Missing --batch=<id>");
  return id;
}

export async function explorerActivateCommand(options: ExplorerActivateOptions = {}): Promise<number> {
  return withSyncRun("explorer:activate", options, async () => {
    const batchId = requiredBatchId(options.batch);
    const confirm = options.confirm?.trim();
    if (!confirm) throw new Error("Missing --confirm=<planHash>");
    await assertHashNotRevoked(confirm);
    const batch = await loadBatchById(batchId);
    if (!batch) throw new Error(`Batch not found: ${batchId}`);
    if (["failed", "rolled_back", "completed"].includes(batch.status)) {
      throw new Error(`Batch ${batchId} status ${batch.status} is not activation-eligible`);
    }
    if (!batch.planHash) throw new Error(`Batch ${batchId} has no planHash`);
    if (confirm !== batch.planHash) {
      throw new Error(`Confirm hash mismatch. Expected ${batch.planHash}, got ${confirm}`);
    }

    const writeStats = await prisma.$queryRaw<Array<{ status: string; n: number }>>(Prisma.sql`
      SELECT "status", COUNT(*)::int AS n
      FROM "public"."ads_explorer_offer_writes"
      WHERE "batch_id" = ${batchId}
      GROUP BY "status"
    `);
    const byStatus = Object.fromEntries(writeStats.map((r) => [r.status, r.n]));
    const total = Number(Object.values(byStatus).reduce((s, v) => s + Number(v), 0));
    const pending = Number(byStatus.pending ?? 0);
    const missingPct = total > 0 ? Number(((pending / total) * 100).toFixed(4)) : 100;

    const blockers: string[] = [];
    if (missingPct > 1) blockers.push(`Missing labels ${missingPct}% > 1%`);
    if (!batch.googleCampaignId) {
      blockers.push("Explorer campaign not created (googleCampaignId missing)");
    }
    if (batch.status === "active") {
      blockers.push(`Batch already active since ${batch.activatedAt ?? "unknown"}`);
    }

    const stats =
      batch.statsJson && typeof batch.statsJson === "object"
        ? (batch.statsJson as Record<string, unknown>)
        : {};
    const explorerCampaign = stats.explorerCampaign as { campaignResourceName?: string } | undefined;
    const explorerAdGroup = stats.explorerCampaign as
      | {
          adGroupResourceName?: string;
          adGroupId?: string | number;
          adGroupAdResourceName?: string;
          adGroupAdId?: string | number;
        }
      | undefined;
    const campaignResourceName =
      explorerCampaign?.campaignResourceName ??
      (batch.googleCampaignId
        ? `customers/${resolveAdsConfig().customerId}/campaigns/${batch.googleCampaignId}`
        : "");
    const adGroupResourceName =
      explorerAdGroup?.adGroupResourceName ??
      (explorerAdGroup?.adGroupId
        ? `customers/${resolveAdsConfig().customerId}/adGroups/${String(explorerAdGroup.adGroupId)}`
        : "");
    const adGroupAdResourceName =
      explorerAdGroup?.adGroupAdResourceName ??
      (explorerAdGroup?.adGroupId && explorerAdGroup?.adGroupAdId
        ? `customers/${resolveAdsConfig().customerId}/adGroupAds/${String(
            explorerAdGroup.adGroupId
          )}~${String(explorerAdGroup.adGroupAdId)}`
        : "");

    const config = resolveAdsConfig();
    const purchaseCheck = await verifyPurchasePrimaryConversion(config, searchAll);
    if (!purchaseCheck.pass) {
      blockers.push(`Primary PURCHASE conversion check failed: ${purchaseCheck.note}`);
    }

    if (blockers.length > 0) {
      throw new Error(`Activation blocked: ${blockers.join("; ")}`);
    }
    if (!adGroupResourceName) {
      throw new Error(
        "Activation blocked: Explorer ad group resource is missing; run explorer:campaign:create again."
      );
    }
    if (!adGroupAdResourceName) {
      throw new Error(
        "Activation blocked: Explorer shopping ad resource is missing; run explorer:campaign:create again."
      );
    }

    const enableResult = await enableExplorerCampaign(config, campaignResourceName);
    const enableAdGroupResult = await enableExplorerAdGroup(config, adGroupResourceName);
    const enableAdGroupAdResult = await enableExplorerAdGroupAd(config, adGroupAdResourceName);
    const activatedAt = new Date();
    const endsAt = expectedBatchEndFromNow(EXPLORER_DEFAULT_BATCH_DAYS);

    await prisma.$executeRaw(Prisma.sql`
      UPDATE "public"."ads_explorer_batches"
      SET
        "status" = 'active',
        "activated_at" = ${activatedAt}::timestamptz,
        "ends_at" = ${endsAt}::timestamptz,
        "stats_json" = COALESCE("stats_json", '{}'::jsonb) || ${JSON.stringify({
          activationAttemptAt: activatedAt.toISOString(),
          confirmedHash: confirm,
          missingPct,
          writesTotal: total,
          purchaseConversionCheck: purchaseCheck,
          enableResult,
          enableAdGroupResult,
          enableAdGroupAdResult,
          liveApplied: true,
        })}::jsonb,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${batchId}
    `);

    const report = {
      batchId,
      confirmedHash: confirm,
      writes: { total, pending, missingPct },
      blockers: [],
      pass: true,
      activatedAt: activatedAt.toISOString(),
      endsAt: endsAt.toISOString(),
      googleCampaignId: batch.googleCampaignId,
      enableResult,
      enableAdGroupResult,
      enableAdGroupAdResult,
      purchaseConversionCheck: purchaseCheck,
    };
    const outPath = await writeExplorerReport(`explorer-activate-${batchId}.json`, report);
    log("explorer_activate.summary", {
      batchId,
      missingPct,
      activatedAt: activatedAt.toISOString(),
      googleCampaignId: batch.googleCampaignId,
      reportPath: outPath,
    });
    return { batchId, missingPct, activated: true, reportPath: outPath };
  });
}
