import {
  EXPLORER_DEFAULT_BATCH_DAYS,
  EXPLORER_DEFAULT_BUDGET_MICROS,
  EXPLORER_DEFAULT_MAX_CPC_MICROS,
  assertNoForbiddenBrandTokens,
  brandDistribution,
  createBatchRecord,
  filterModelsBySourceCampaignName,
  filterModelsWithEmptyPrimaryCustomLabel3,
  loadBaseCandidates,
  loadCandidateOffersForModels,
  loadExplorerCampaignsAndListingNodes,
  mapModelToSingleSourceCampaign,
  evaluateRoutingCleanModels,
  planHashFromPayload,
  saveListingBackups,
  selectBatchModelsStratified,
  upsertBatchModels,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import {
  EXPLORER_ACTIVE_LABEL,
  explorerLabelForBrand,
} from "@/adsanalytics/explorer/labels";
import { log, withSyncRun } from "@/adsanalytics/run";

type ExplorerPlanOptions = {
  models?: number;
  days?: number;
  seed?: string;
  requireRoutingClean?: boolean;
  sourceCampaignName?: string;
  requireEmptyCustomLabel3?: boolean;
  abortForbiddenBrands?: boolean;
  brand?: string;
};

type ExplorerPlanPoolOptions = Pick<
  ExplorerPlanOptions,
  "days" | "requireRoutingClean" | "sourceCampaignName" | "requireEmptyCustomLabel3"
>;

/** Count models that pass the same filters as explorer:plan (no batch created). */
export async function countExplorerPlanPool(
  options: ExplorerPlanPoolOptions = {}
): Promise<number> {
  const lookbackDays = Math.max(7, Math.floor(options.days ?? 30));
  const requireRoutingClean = options.requireRoutingClean === true;
  const sourceCampaignName = options.sourceCampaignName?.trim() || "";
  const requireEmptyCustomLabel3 = options.requireEmptyCustomLabel3 === true;

  const [baseCandidates, listingCtx] = await Promise.all([
    loadBaseCandidates(lookbackDays),
    loadExplorerCampaignsAndListingNodes(),
  ]);
  const offersByModel = await loadCandidateOffersForModels(
    baseCandidates.map((c) => c.shopifyProductId)
  );
  const mapped = mapModelToSingleSourceCampaign(
    baseCandidates,
    offersByModel,
    listingCtx.campaigns,
    listingCtx.listingNodes
  );
  const routing = requireRoutingClean
    ? evaluateRoutingCleanModels(mapped.mapped, offersByModel, listingCtx.campaigns, listingCtx.listingNodes)
    : { clean: mapped.mapped, rejected: [] };

  let pool = routing.clean;
  if (sourceCampaignName) {
    pool = filterModelsBySourceCampaignName(pool, sourceCampaignName).kept;
  }
  if (requireEmptyCustomLabel3) {
    pool = filterModelsWithEmptyPrimaryCustomLabel3(pool, offersByModel).kept;
  }
  return pool.length;
}

export async function explorerPlanCommand(options: ExplorerPlanOptions = {}): Promise<number> {
  return withSyncRun("explorer:plan", options, async () => {
    const modelTarget = Math.max(1, Math.floor(options.models ?? 500));
    const lookbackDays = Math.max(7, Math.floor(options.days ?? 30));
    const seed = options.seed?.trim() || "pilot-001";
    const requireRoutingClean = options.requireRoutingClean === true;
    const sourceCampaignName = options.sourceCampaignName?.trim() || "";
    const requireEmptyCustomLabel3 = options.requireEmptyCustomLabel3 === true;
    const abortForbiddenBrands = options.abortForbiddenBrands !== false;
    const brand = options.brand?.trim().toLowerCase() || "";
    const explorerLabel = brand ? explorerLabelForBrand(brand) : EXPLORER_ACTIVE_LABEL;

    const [baseCandidates, listingCtx] = await Promise.all([
      loadBaseCandidates(lookbackDays),
      loadExplorerCampaignsAndListingNodes(),
    ]);

    const offersByModel = await loadCandidateOffersForModels(
      baseCandidates.map((c) => c.shopifyProductId)
    );

    const mapped = mapModelToSingleSourceCampaign(
      baseCandidates,
      offersByModel,
      listingCtx.campaigns,
      listingCtx.listingNodes
    );

    const routing = requireRoutingClean
      ? evaluateRoutingCleanModels(mapped.mapped, offersByModel, listingCtx.campaigns, listingCtx.listingNodes)
      : { clean: mapped.mapped, rejected: [] as Array<{ shopifyProductId: string; reason: string; offerId: string; campaignCount: number }> };

    let pool = routing.clean;
    let sourceCampaignRejected: Array<{
      shopifyProductId: string;
      reason: string;
      sourceCampaignName: string;
    }> = [];
    if (sourceCampaignName) {
      const filtered = filterModelsBySourceCampaignName(pool, sourceCampaignName);
      pool = filtered.kept;
      sourceCampaignRejected = filtered.rejected;
    }

    let emptyLabelRejected: Array<{
      shopifyProductId: string;
      reason: string;
      offerId: string;
      customAttr3: string;
    }> = [];
    if (requireEmptyCustomLabel3) {
      const filtered = filterModelsWithEmptyPrimaryCustomLabel3(pool, offersByModel);
      pool = filtered.kept;
      emptyLabelRejected = filtered.rejected;
    }

    if (pool.length < modelTarget) {
      throw new Error(
        `Not enough candidates after filters: have ${pool.length}, need ${modelTarget}` +
          (sourceCampaignName ? ` (source_campaign_name=${sourceCampaignName})` : "")
      );
    }

    const selectedPack = selectBatchModelsStratified(pool, modelTarget, seed);
    const selected = selectedPack.selected;
    if (selected.length !== modelTarget) {
      throw new Error(`Expected exactly ${modelTarget} models, got ${selected.length}`);
    }

    if (sourceCampaignName) {
      const wrong = selected.filter((s) => s.sourceCampaignName !== sourceCampaignName);
      if (wrong.length > 0) {
        throw new Error(
          `Abort: ${wrong.length} selected models have source_campaign_name != "${sourceCampaignName}"`
        );
      }
    }

    const selectedBrandDist = brandDistribution(selected);
    if (abortForbiddenBrands) {
      assertNoForbiddenBrandTokens(
        selected.flatMap((s) => [
          { where: `model.${s.shopifyProductId}.brand`, text: s.brand },
          { where: `model.${s.shopifyProductId}.source_campaign`, text: s.sourceCampaignName },
        ])
      );
    }

    const selectedModelIds = new Set(selected.map((s) => s.shopifyProductId));
    let offerCount = 0;
    for (const id of selectedModelIds) {
      offerCount += offersByModel.get(id)?.length ?? 0;
    }

    const planPayload = {
      seed,
      modelTarget,
      lookbackDays,
      sourceCampaignName: sourceCampaignName || null,
      requireEmptyCustomLabel3,
      requireRoutingClean,
      selectedModels: selected.map((s) => ({
        shopifyProductId: s.shopifyProductId,
        sourceCampaignId: s.sourceCampaignId,
        sourceCampaignName: s.sourceCampaignName,
        brand: s.brand,
        offerCount: s.offerCount,
      })),
      brandDistribution: selectedBrandDist,
      allocationByCampaign: selectedPack.allocationByCampaign,
      budgets: {
        dailyBudgetMicros: EXPLORER_DEFAULT_BUDGET_MICROS,
        maxCpcMicros: EXPLORER_DEFAULT_MAX_CPC_MICROS,
      },
      constraints: {
        zeroImpressionsDays: lookbackDays,
        zeroGoogleConversionsAllTime: true,
        zeroShopifySales365: true,
        exactlyOneSourceCampaign: true,
        productAgeDays: 30,
        routingClean: requireRoutingClean,
        emptyPrimaryCustomLabel3: requireEmptyCustomLabel3,
        sourceCampaignNameExact: sourceCampaignName || null,
      },
    };
    const planHash = planHashFromPayload(planPayload);
    const endsAt = new Date();
    endsAt.setUTCDate(endsAt.getUTCDate() + EXPLORER_DEFAULT_BATCH_DAYS);

    const batchId = await createBatchRecord({
      status: "planned",
      modelCount: selected.length,
      offerCount,
      dailyBudgetMicros: BigInt(EXPLORER_DEFAULT_BUDGET_MICROS),
      maxCpcMicros: BigInt(EXPLORER_DEFAULT_MAX_CPC_MICROS),
      endsAt,
      planHash,
      statsJson: {
        baseCandidates: baseCandidates.length,
        mappedSingleSource: mapped.mapped.length,
        rejectedForSource: mapped.rejected.length,
        routingCleanRequired: requireRoutingClean,
        routingCleanCount: routing.clean.length,
        routingRejected: routing.rejected.length,
        sourceCampaignName: sourceCampaignName || null,
        sourceCampaignRejected: sourceCampaignRejected.length,
        emptyCustomLabel3Rejected: emptyLabelRejected.length,
        poolAfterFilters: pool.length,
        lookbackDays,
        seed,
        brand: brand || null,
        explorerLabel,
      },
    });
    await upsertBatchModels(batchId, selected);
    const listingBackup = await saveListingBackups(batchId, listingCtx.listingNodes);

    const modelsExport = selected.map((s) => ({
      shopifyProductId: s.shopifyProductId,
      brand: s.brand,
      sourceCampaignId: s.sourceCampaignId,
      sourceCampaignName: s.sourceCampaignName,
      offerCount: s.offerCount,
      score: s.score,
    }));

    const report = {
      batchId,
      planHash,
      summary: {
        baseCandidates: baseCandidates.length,
        mappedSingleSource: mapped.mapped.length,
        rejectedForSource: mapped.rejected.length,
        routingCleanRequired: requireRoutingClean,
        routingCleanCount: routing.clean.length,
        routingRejected: routing.rejected.length,
        sourceCampaignName: sourceCampaignName || null,
        sourceCampaignRejected: sourceCampaignRejected.length,
        emptyCustomLabel3Rejected: emptyLabelRejected.length,
        poolAfterFilters: pool.length,
        selectedModels: selected.length,
        selectedOffers: offerCount,
      },
      brandDistribution: selectedBrandDist,
      allocationByCampaign: selectedPack.allocationByCampaign,
      selectedModels: modelsExport,
      rejectedSample: mapped.rejected.slice(0, 200),
      routingRejectedSample: routing.rejected.slice(0, 300),
      emptyCustomLabel3RejectedSample: emptyLabelRejected.slice(0, 100),
      listingBackup,
      listingCampaignRules: listingCtx.campaigns,
      notes: [
        "Candidate age proxy used: ShopifySyncState.createdAt (shopify product created_at not materialized in DB).",
        "Source campaign attribution uses real live listing_group trees, not shopping_product campaign scope.",
        sourceCampaignName
          ? `Pilot restricted to source_campaign_name exactly "${sourceCampaignName}".`
          : "No source campaign name filter applied.",
      ],
      settings: {
        modelTarget,
        lookbackDays,
        seed,
        sourceCampaignName: sourceCampaignName || null,
        requireEmptyCustomLabel3,
        requireRoutingClean,
        budgetChfDay: EXPLORER_DEFAULT_BUDGET_MICROS / 1e6,
        maxCpcChf: EXPLORER_DEFAULT_MAX_CPC_MICROS / 1e6,
        batchDays: EXPLORER_DEFAULT_BATCH_DAYS,
      },
    };
    const outPath = await writeExplorerReport(`explorer-plan-${batchId}.json`, report);
    const exportPath = await writeExplorerReport(`explorer-models-${batchId}.json`, {
      batchId,
      planHash,
      modelCount: modelsExport.length,
      brandDistribution: selectedBrandDist,
      models: modelsExport,
    });

    log("explorer_plan.summary", {
      batchId,
      planHash,
      baseCandidates: baseCandidates.length,
      mappedSingleSource: mapped.mapped.length,
      sourceCampaignName: sourceCampaignName || null,
      poolAfterFilters: pool.length,
      selectedModels: selected.length,
      selectedOffers: offerCount,
      brandCount: selectedBrandDist.length,
      listingBackupRows: listingBackup.rows,
      reportPath: outPath,
      modelsExportPath: exportPath,
    });

    return {
      batchId,
      planHash,
      selectedModels: selected.length,
      selectedOffers: offerCount,
      brandDistribution: selectedBrandDist,
      reportPath: outPath,
      modelsExportPath: exportPath,
    };
  });
}
