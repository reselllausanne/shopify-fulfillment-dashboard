import {
  assertHashNotRevoked,
  assertNoForbiddenBrandTokens,
  EXPLORER_OPS_DAILY_LIMIT,
  estimateListingMutationOps,
  estimateOptimizedListingMutationOps,
  loadBatchById,
  loadExplorerCampaignsAndListingNodes,
  loadOfferAttrsForBatch,
  planHashFromPayload,
  saveListingBackups,
  updateBatchStatus,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import { ROUTED_LABELS } from "@/adsanalytics/explorer/labels";
import { resolveAdsConfig } from "@/adsanalytics/config";
import {
  applyCoreExclusionMutations,
  verifyCoreExclusionSample,
} from "@/adsanalytics/google/listingGroupMutations";
import { log, withSyncRun } from "@/adsanalytics/run";
import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";

type ExplorerCoreExclusionsOptions = {
  batch?: string;
  validateOnly?: boolean;
  confirm?: string;
  allowOnlySourceCampaignName?: string;
  allowForbiddenBrands?: boolean;
};

function requiredBatchId(batchId: string | undefined): string {
  const id = batchId?.trim();
  if (!id) throw new Error("Missing --batch=<id>");
  return id;
}

export async function explorerCoreExclusionsCommand(
  options: ExplorerCoreExclusionsOptions = {}
): Promise<number> {
  return withSyncRun("explorer:core-exclusions", options, async () => {
    const batchId = requiredBatchId(options.batch);
    const validateOnly = options.validateOnly !== false;
    const allowOnlySourceCampaignName = options.allowOnlySourceCampaignName?.trim() || "";
    const batch = await loadBatchById(batchId);
    if (!batch) throw new Error(`Batch not found: ${batchId}`);
    const listingCtx = await loadExplorerCampaignsAndListingNodes();
    const estimate = estimateListingMutationOps(listingCtx.listingNodes);
    const optimized = await estimateOptimizedListingMutationOps(batchId);

    // Sort nodes: Google Ads search order is non-deterministic; unsorted JSON breaks confirm hashes.
    const listingNodesForHash = listingCtx.listingNodes
      .map((n) => ({
        campaignId: n.campaignId,
        assetGroupId: n.assetGroupId,
        nodeId: n.id,
        type: n.type,
        dimension: n.dimension,
      }))
      .sort((a, b) =>
        `${a.campaignId}|${a.assetGroupId}|${a.nodeId}`.localeCompare(
          `${b.campaignId}|${b.assetGroupId}|${b.nodeId}`
        )
      );
    const planPayload = {
      batchId,
      listingNodes: listingNodesForHash,
      mutationIntent:
        `Transform INCLUDED leaves into subdivision by custom_label_3 with ${ROUTED_LABELS.join(", ")} excluded and everything_else included`,
      allowOnlySourceCampaignName: allowOnlySourceCampaignName || null,
      touchedLeafIds: optimized.touchedLeafIds,
    };
    const planHash = planHashFromPayload(planPayload);

    const blockers: string[] = [];
    // Caps apply to the operations actually sent. estimate.* is the whole-account
    // worst case and stays informational only.
    if (optimized.operationsAfter > 2000) {
      blockers.push(`Listing operations ${optimized.operationsAfter} exceed 2000 cap`);
    }
    if (optimized.operationsAfter > EXPLORER_OPS_DAILY_LIMIT) {
      blockers.push(`Listing operations exceed account daily limit ${EXPLORER_OPS_DAILY_LIMIT}`);
    }
    if (optimized.includedLeafTouched > 100) {
      blockers.push(`Touched included leaves ${optimized.includedLeafTouched} > 100 for 500-model batch`);
    }
    if (optimized.operationsAfter > 400) {
      blockers.push(`Optimized listing operations ${optimized.operationsAfter} > 400`);
    }
    if (optimized.offerLeafResolutionIssues.length > 0) {
      blockers.push(
        `Offer-to-leaf resolution issues: ${optimized.offerLeafResolutionIssues.length} (zero or multiple leaves)`
      );
    }
    const riskyAssetGroup = Math.ceil(optimized.includedLeafTouched / Math.max(optimized.assetGroupsTouched, 1));
    if (riskyAssetGroup + 3 > 1000) {
      blockers.push("At least one asset group may exceed 1000 listing groups after mutation");
    }

    if (allowOnlySourceCampaignName) {
      const wrongSources = optimized.sourceCampaignNames.filter((n) => n !== allowOnlySourceCampaignName);
      if (wrongSources.length > 0) {
        blockers.push(
          `Batch source campaigns not restricted to "${allowOnlySourceCampaignName}": ${wrongSources.join(", ")}`
        );
      }
      const wrongTouched = optimized.touchedCampaignNames.filter((n) => n !== allowOnlySourceCampaignName);
      if (wrongTouched.length > 0) {
        blockers.push(
          `Exclusion plan touches non-"${allowOnlySourceCampaignName}" campaigns: ${wrongTouched.join(", ")}`
        );
      }
      if (optimized.touchedCampaignNames.length === 0) {
        blockers.push(`No listing leaves touched for allowed campaign "${allowOnlySourceCampaignName}"`);
      }
    }

    if (options.allowForbiddenBrands !== true) {
      try {
        assertNoForbiddenBrandTokens([
          ...optimized.modelBrands.map((b) => ({ where: "model.brand", text: b })),
          ...optimized.sourceCampaignNames.map((n) => ({ where: "source.campaign", text: n })),
          ...optimized.touchedCampaignNames.map((n) => ({ where: "touched.campaign", text: n })),
          ...optimized.touchedAssetGroupIds.map((id) => ({ where: "touched.asset_group", text: id })),
          ...optimized.touchedLeafPaths.map((p) => ({ where: "touched.leaf_path", text: p })),
        ]);
      } catch (err) {
        blockers.push(err instanceof Error ? err.message : String(err));
      }
    }

    let applied = false;
    let backupRows = 0;
    let backupHash = "";
    let mutationResult: Awaited<ReturnType<typeof applyCoreExclusionMutations>> | null = null;
    let postApplyVerification: ReturnType<typeof verifyCoreExclusionSample> | null = null;
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
      if (blockers.length > 0) {
        throw new Error(`Blocked by safety checks: ${blockers.join("; ")}`);
      }
      const backup = await saveListingBackups(batchId, listingCtx.listingNodes);
      backupRows = backup.rows;
      backupHash = backup.treeHash;

      const config = resolveAdsConfig();
      mutationResult = await applyCoreExclusionMutations(
        config,
        listingCtx.listingNodes,
        optimized.touchedLeafIds,
        { validateOnlyFirst: true }
      );
      if (!mutationResult.perAssetGroup.every((g) => g.applied && !g.error)) {
        const failed = mutationResult.perAssetGroup.filter((g) => !g.applied || g.error);
        throw new Error(
          `Live listing group mutation failed: ${failed.map((g) => `${g.assetGroupId}:${g.error ?? "not applied"}`).join("; ")}`
        );
      }
      applied = true;

      const refreshed = await loadExplorerCampaignsAndListingNodes();
      const batchOffers = await loadOfferAttrsForBatch(batchId);
      const sourceCampaignId =
        optimized.touchedCampaignNames.length === 1
          ? listingCtx.campaigns.find((c) => c.campaignName === optimized.touchedCampaignNames[0])
              ?.campaignId
          : undefined;
      const verifyCampaignId =
        sourceCampaignId ??
        listingCtx.campaigns.find((c) => c.campaignName === allowOnlySourceCampaignName)?.campaignId ??
        "";

      const neighborRows = verifyCampaignId
        ? await prisma.$queryRaw<
            Array<{
              offer_id: string;
              brand: string;
              product_type: string;
              custom_attr0: string;
              custom_attr1: string;
              custom_attr2: string;
              custom_attr3: string;
              custom_attr4: string;
            }>
          >(Prisma.sql`
            SELECT DISTINCT
              p."offer_id",
              COALESCE(p."brand",'') AS brand,
              COALESCE(p."product_type",'') AS product_type,
              COALESCE(p."custom_attr0",'') AS custom_attr0,
              COALESCE(p."custom_attr1",'') AS custom_attr1,
              COALESCE(p."custom_attr2",'') AS custom_attr2,
              COALESCE(p."custom_attr3",'') AS custom_attr3,
              COALESCE(p."custom_attr4",'') AS custom_attr4
            FROM "public"."ads_shopping_product_current" p
            WHERE p."is_current" = true
              AND ${verifyCampaignId} = ANY(p."targeted_campaign_ids")
              AND p."shopify_product_id" IS NOT NULL
              AND p."shopify_product_id" NOT IN (
                SELECT "shopify_product_id"
                FROM "public"."ads_explorer_batch_models"
                WHERE "batch_id" = ${batchId}
              )
            LIMIT 48
          `)
        : [];

      const neighborOffers = neighborRows.map((row) => ({
        offerId: row.offer_id,
        brand: row.brand,
        productType: row.product_type,
        customAttr0: row.custom_attr0,
        customAttr1: row.custom_attr1,
        customAttr2: row.custom_attr2,
        customAttr3: row.custom_attr3,
        customAttr4: row.custom_attr4,
      }));

      postApplyVerification = verifyCampaignId
        ? verifyCoreExclusionSample(
            refreshed.listingNodes,
            batchOffers,
            neighborOffers,
            verifyCampaignId
          )
        : { brands: [], allPass: false };

      await updateBatchStatus(batchId, "ready", {
        statsJson: {
          coreExclusionsPlanHash: planHash,
          backupRows,
          backupHash,
          liveApplied: true,
          mutationResult,
          postApplyVerification,
        },
      });
    }

    const report = {
      batchId,
      validateOnly,
      planHash,
      allowOnlySourceCampaignName: allowOnlySourceCampaignName || null,
      estimate,
      optimized,
      blockers,
      pass: blockers.length === 0,
      backupRows,
      backupHash,
      applied,
      mutationResult,
      postApplyVerification,
      note: validateOnly
        ? "validate_only computes deterministic plan and safety checks; no Ads mutations."
        : applied
          ? "Live core exclusions applied to touched UNIT_INCLUDED leaves."
          : "Apply did not run.",
      campaigns: listingCtx.campaigns,
      sampleNodePreview: listingCtx.listingNodes.slice(0, 120),
      proofNonExplorerIncluded: optimized.sampleProofNonExplorerIncluded,
    };
    const outPath = await writeExplorerReport(`explorer-core-exclusions-${batchId}.json`, report);
    log("explorer_core_exclusions.summary", {
      batchId,
      validateOnly,
      planHash,
      pass: report.pass,
      blockers,
      estimatedOperations: estimate.estimatedOperations,
      optimizedOperations: optimized.operationsAfter,
      touchedLeaves: optimized.includedLeafTouched,
      touchedCampaignNames: optimized.touchedCampaignNames,
      reportPath: outPath,
    });
    return {
      batchId,
      validateOnly,
      planHash,
      pass: report.pass,
      blockers,
      estimatedOperations: estimate.estimatedOperations,
      optimizedOperations: optimized.operationsAfter,
      touchedLeaves: optimized.includedLeafTouched,
      touchedCampaignNames: optimized.touchedCampaignNames,
      reportPath: outPath,
    };
  });
}
