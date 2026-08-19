import {
  assertHashNotRevoked,
  EXPLORER_DEFAULT_BATCH_DAYS,
  EXPLORER_DEFAULT_BUDGET_MICROS,
  EXPLORER_DEFAULT_FEED_LABEL,
  EXPLORER_DEFAULT_MAX_CPC_MICROS,
  EXPLORER_DEFAULT_MERCHANT_ID,
  loadBatchById,
  planHashFromPayload,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import { resolveAdsConfig } from "@/adsanalytics/config";
import { createExplorerShoppingCampaign } from "@/adsanalytics/google/explorerCampaignMutations";
import { log, withSyncRun } from "@/adsanalytics/run";
import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";

type ExplorerCampaignCreateOptions = {
  batch?: string;
  validateOnly?: boolean;
  confirm?: string;
  brand?: string;
  nameSuffix?: string;
};

function requiredBatchId(batchId: string | undefined): string {
  const id = batchId?.trim();
  if (!id) throw new Error("Missing --batch=<id>");
  return id;
}

export async function explorerCampaignCreateCommand(
  options: ExplorerCampaignCreateOptions = {}
): Promise<number> {
  return withSyncRun("explorer:campaign:create", options, async () => {
    const batchId = requiredBatchId(options.batch);
    const validateOnly = options.validateOnly !== false;
    const batch = await loadBatchById(batchId);
    if (!batch) throw new Error(`Batch not found: ${batchId}`);

    const brand = options.brand?.trim() || "";
    const nameSuffix = options.nameSuffix?.trim() || "Long Tail";
    const campaignName = `Explorer | ${nameSuffix} | CH`;

    const spec = {
      campaignName,
      type: "STANDARD_SHOPPING",
      bidding: "MANUAL_CPC",
      budgetMicros: Number(batch.dailyBudgetMicros || String(EXPLORER_DEFAULT_BUDGET_MICROS)),
      maxCpcMicros: Number(batch.maxCpcMicros || String(EXPLORER_DEFAULT_MAX_CPC_MICROS)),
      merchantId: EXPLORER_DEFAULT_MERCHANT_ID,
      feedLabel: EXPLORER_DEFAULT_FEED_LABEL,
      country: "CH",
      startOnActivation: true,
      endAfterDays: EXPLORER_DEFAULT_BATCH_DAYS,
      adGroupName: "Explorer Products",
      listingGroup: {
        rootSubdivision: "custom_label_3",
        includeValue: "explorer_active",
        include: "INCLUDED",
        everythingElse: "EXCLUDED",
        brandFilter: brand || null,
      },
      statusOnCreate: "PAUSED",
      targetRoas: null,
      assets: "none",
    };
    const planHash = planHashFromPayload({ batchId, spec });

    let applied = false;
    let createResult: Awaited<ReturnType<typeof createExplorerShoppingCampaign>> | null = null;
    if (!validateOnly) {
      const confirm = options.confirm?.trim();
      if (!confirm) throw new Error("Missing --confirm=<planHash> for non validate-only run");
      await assertHashNotRevoked(confirm);
      if (confirm !== planHash) {
        throw new Error(`Confirm hash mismatch. Expected ${planHash}, got ${confirm}`);
      }
      if (["failed", "rolled_back", "completed"].includes(batch.status)) {
        throw new Error(`Batch ${batchId} status ${batch.status} is not apply-eligible`);
      }
      if (batch.googleCampaignId) {
        throw new Error(
          `Batch ${batchId} already has googleCampaignId=${batch.googleCampaignId}; refusing duplicate create`
        );
      }

      const config = resolveAdsConfig();
      createResult = await createExplorerShoppingCampaign(
        config,
        {
          campaignName: spec.campaignName,
          budgetMicros: spec.budgetMicros,
          maxCpcMicros: spec.maxCpcMicros,
          merchantId: spec.merchantId,
          feedLabel: spec.feedLabel,
          endAfterDays: spec.endAfterDays,
          adGroupName: spec.adGroupName,
          brandFilter: brand || undefined,
        },
        { validateOnlyFirst: true }
      );
      applied = true;

      await prisma.$executeRaw(Prisma.sql`
        UPDATE "public"."ads_explorer_batches"
        SET
          "google_campaign_id" = ${createResult.campaignId},
          "stats_json" = COALESCE("stats_json", '{}'::jsonb) || ${JSON.stringify({
            campaignCreatePlanHash: planHash,
            liveApplied: true,
            explorerCampaign: {
              campaignId: createResult.campaignId,
              campaignResourceName: createResult.campaignResourceName,
              budgetResourceName: createResult.budgetResourceName,
              adGroupId: createResult.adGroupId,
              adGroupResourceName: createResult.adGroupResourceName,
              adGroupAdId: createResult.adGroupAdId,
              adGroupAdResourceName: createResult.adGroupAdResourceName,
              operationCount: createResult.operationCount,
            },
          })}::jsonb,
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${batchId}
      `);
    }

    const report = {
      batchId,
      validateOnly,
      planHash,
      applied,
      createResult,
      campaignSpec: spec,
      note: validateOnly
        ? "validate_only validates deterministic campaign spec; no Ads mutations."
        : applied
          ? "Explorer Standard Shopping campaign created PAUSED with listing group tree."
          : "Create did not run.",
    };
    const outPath = await writeExplorerReport(`explorer-campaign-create-${batchId}.json`, report);
    log("explorer_campaign_create.summary", {
      batchId,
      validateOnly,
      planHash,
      applied,
      campaignId: createResult?.campaignId ?? null,
      reportPath: outPath,
    });
    return { batchId, validateOnly, planHash, applied, reportPath: outPath };
  });
}
