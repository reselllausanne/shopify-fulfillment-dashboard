import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { resolveAdsConfig, type AdsConfig } from "@/adsanalytics/config";
import { authHealthCommand } from "@/adsanalytics/commands/authHealth";
import { countExplorerPlanPool, explorerPlanCommand } from "@/adsanalytics/commands/explorerPlan";
import { explorerPreflightCommand } from "@/adsanalytics/commands/explorerPreflight";
import { explorerMerchantApplyCommand } from "@/adsanalytics/commands/explorerMerchantApply";
import { explorerActivateCommand } from "@/adsanalytics/commands/explorerActivate";
import {
  computeWritePlanHash,
  outboxCounts,
  runOrThrow,
} from "@/adsanalytics/commands/explorerWeeklyPlan";
import {
  fetchCampaignFacts,
  listShoppingCampaignIds,
  type CampaignFacts,
} from "@/adsanalytics/explorer/campaignInspect";
import {
  loadExplorerCampaignsAndListingNodes,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import {
  CUSTOM_LABEL_3_INDEX,
  ROUTED_LABELS,
  explorerLabelForBrand,
} from "@/adsanalytics/explorer/labels";
import { googleAdsMutate, searchAll } from "@/adsanalytics/google/adsClient";
import { findSubdivisionsMissingLabelExclusion } from "@/adsanalytics/google/listingGroupMutations";
import { EXIT_OK, log, withSyncRun } from "@/adsanalytics/run";

/** Brand -> core PMax campaign the Explorer models are pulled from (exact Ads names). */
export const BRAND_SOURCE_CAMPAIGNS: Record<string, string> = {
  nike: "Nike PM Feed Only",
  jordan: "Jordan PM Feed Only",
  adidas: "Adidas PM Feed only",
};

const CYCLE_MARKER = "brand_cycle";
const DEFAULT_MODELS = 300;
const DEFAULT_BATCH_DAYS = 5;
const DEFAULT_MAX_CPC_MICROS = 700_000;
const POOL_FLOOR_MODELS = 50;
const LOOKBACK_DAYS = 30;
const NON_TERMINAL_STATUSES = ["planned", "ready", "running", "labeling", "active"];

export type ExplorerBrandCycleOptions = {
  brands?: string;
  models?: number;
  batchDays?: number;
  maxCpcMicros?: number;
  dryRun?: boolean;
};

type BrandBatchRow = {
  id: string;
  status: string;
  plan_hash: string;
  google_campaign_id: string | null;
};

async function findOpenBrandBatch(brand: string): Promise<BrandBatchRow | null> {
  const rows = await prisma.$queryRaw<BrandBatchRow[]>(Prisma.sql`
    SELECT "id", "status", "plan_hash", "google_campaign_id"
    FROM "public"."ads_explorer_batches"
    WHERE "stats_json"->>'cycle' = ${CYCLE_MARKER}
      AND "stats_json"->>'brand' = ${brand}
      AND "status" = ANY(${NON_TERMINAL_STATUSES}::text[])
    ORDER BY "created_at" DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function findBatchBySeed(seed: string): Promise<BrandBatchRow | null> {
  const rows = await prisma.$queryRaw<BrandBatchRow[]>(Prisma.sql`
    SELECT "id", "status", "plan_hash", "google_campaign_id"
    FROM "public"."ads_explorer_batches"
    WHERE "stats_json"->>'seed' = ${seed}
    ORDER BY "created_at" DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

/** The single Shopping campaign whose product groups include the brand's explorer label. */
async function resolveBrandExplorerCampaign(
  config: AdsConfig,
  label: string
): Promise<CampaignFacts> {
  const ids = await listShoppingCampaignIds(config);
  const facts = await fetchCampaignFacts(config, ids);
  const matches = [...facts.values()].filter((c) => c.includedCustomLabel3.includes(label));
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one Shopping campaign including custom_label_3=${label}, found ${matches.length}` +
        (matches.length ? `: ${matches.map((m) => `${m.campaignId} (${m.campaignName})`).join(", ")}` : "")
    );
  }
  const campaign = matches[0]!;
  if (!campaign.adGroupResourceName || !campaign.adGroupAdResourceName) {
    throw new Error(`Campaign ${campaign.campaignId} is missing its ad group or shopping ad`);
  }
  return campaign;
}

/**
 * A labeled model leaves its core campaign only if every included leaf there excludes the
 * label. Without that guard the model would sit in both campaigns at once.
 */
async function assertSourceExcludesRoutedLabels(sourceCampaignName: string): Promise<string> {
  const ctx = await loadExplorerCampaignsAndListingNodes();
  const source = ctx.campaigns.find((c) => c.campaignName === sourceCampaignName);
  if (!source) throw new Error(`Source campaign "${sourceCampaignName}" not found or not ENABLED`);
  const nodes = ctx.listingNodes.filter((n) => n.campaignId === source.campaignId);
  const unprotectedLeaves = nodes.filter(
    (n) =>
      n.type === "UNIT_INCLUDED" &&
      !(n.dimension.kind === "product_custom_attribute" && n.dimension.index === CUSTOM_LABEL_3_INDEX)
  ).length;
  const missing = ROUTED_LABELS.filter(
    (label) => findSubdivisionsMissingLabelExclusion(nodes, source.campaignId, label).length > 0
  );
  if (unprotectedLeaves > 0 || missing.length > 0) {
    throw new Error(
      `Source "${sourceCampaignName}" does not exclude routed labels (unprotected leaves=${unprotectedLeaves}, missing=${missing.join(",") || "none"}). ` +
        `Run: ads -- pmax:exclude-routed-labels --campaign-id=${source.campaignId}`
    );
  }
  return source.campaignId;
}

/** Align the ad group default and every positive listing unit on the target max CPC. */
async function enforceMaxCpc(
  config: AdsConfig,
  campaign: CampaignFacts,
  maxCpcMicros: number
): Promise<number> {
  const { rows } = await searchAll(
    config,
    [
      "SELECT ad_group_criterion.resource_name, ad_group_criterion.cpc_bid_micros",
      "FROM ad_group_criterion",
      `WHERE campaign.id = ${campaign.campaignId}`,
      "  AND ad_group_criterion.type = 'LISTING_GROUP'",
      "  AND ad_group_criterion.listing_group.type = 'UNIT'",
      "  AND ad_group_criterion.negative = false",
      "  AND ad_group_criterion.status != 'REMOVED'",
    ].join("\n")
  );
  const target = String(maxCpcMicros);
  const ops: unknown[] = [];
  if (campaign.maxCpcMicros !== target) {
    ops.push({
      adGroupOperation: {
        update: { resourceName: campaign.adGroupResourceName, cpcBidMicros: target },
        updateMask: "cpc_bid_micros",
      },
    });
  }
  for (const row of rows) {
    const criterion = (row.adGroupCriterion ?? {}) as { resourceName?: string; cpcBidMicros?: string };
    if (!criterion.resourceName || criterion.cpcBidMicros === target) continue;
    ops.push({
      adGroupCriterionOperation: {
        update: { resourceName: criterion.resourceName, cpcBidMicros: target },
        updateMask: "cpc_bid_micros",
      },
    });
  }
  if (ops.length > 0) await googleAdsMutate(config, ops, { partialFailure: false });
  return ops.length;
}

async function attachBrandCampaign(batchId: string, campaign: CampaignFacts): Promise<void> {
  const patch = {
    brandCycleAttachedAt: new Date().toISOString(),
    explorerCampaign: {
      campaignId: campaign.campaignId,
      campaignResourceName: campaign.campaignResourceName,
      budgetResourceName: campaign.budgetResourceName,
      adGroupId: campaign.adGroupId,
      adGroupResourceName: campaign.adGroupResourceName,
      adGroupAdResourceName: campaign.adGroupAdResourceName,
      reused: true,
    },
  };
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "public"."ads_explorer_batches"
    SET
      "google_campaign_id" = ${campaign.campaignId},
      "stats_json" = COALESCE("stats_json", '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${batchId}
  `);
}

function cycleSeed(brand: string, now = new Date()): string {
  return `brand-${brand}-${now.toISOString().slice(0, 13).replace(/[-T:]/g, "")}`;
}

type BrandOutcome = Record<string, unknown> & { brand: string; action: string };

async function runBrand(
  brand: string,
  opts: Required<Omit<ExplorerBrandCycleOptions, "brands">>,
  config: AdsConfig
): Promise<BrandOutcome> {
  const sourceCampaignName = BRAND_SOURCE_CAMPAIGNS[brand]!;
  const label = explorerLabelForBrand(brand);

  const open = await findOpenBrandBatch(brand);
  if (open?.status === "active") {
    return { brand, action: "skip_active", batchId: open.id };
  }

  const campaign = await resolveBrandExplorerCampaign(config, label);
  await assertSourceExcludesRoutedLabels(sourceCampaignName);

  let batch = open;
  if (!batch) {
    const pool = await countExplorerPlanPool({
      days: LOOKBACK_DAYS,
      requireRoutingClean: true,
      sourceCampaignName,
      requireEmptyCustomLabel3: true,
    });
    if (pool < POOL_FLOOR_MODELS) {
      return { brand, action: "skip_low_pool", pool, floor: POOL_FLOOR_MODELS };
    }
    const models = Math.min(opts.models, pool);
    if (opts.dryRun) {
      return { brand, action: "dry_run", pool, models, campaignId: campaign.campaignId, sourceCampaignName };
    }
    const seed = cycleSeed(brand);
    await runOrThrow("explorer:plan", () =>
      explorerPlanCommand({
        models,
        days: LOOKBACK_DAYS,
        seed,
        requireRoutingClean: true,
        sourceCampaignName,
        requireEmptyCustomLabel3: true,
        abortForbiddenBrands: false,
        brand,
        batchDays: opts.batchDays,
        maxCpcMicros: opts.maxCpcMicros,
        extraStats: { cycle: CYCLE_MARKER },
      })
    );
    batch = await findBatchBySeed(seed);
    if (!batch) throw new Error(`Batch missing after explorer:plan for seed=${seed}`);
    log("explorer_brand_cycle.batch_created", { brand, batchId: batch.id, pool, models });
  } else if (opts.dryRun) {
    return { brand, action: "dry_run_resume", batchId: batch.id, status: batch.status };
  } else {
    log("explorer_brand_cycle.resume_batch", { brand, batchId: batch.id, status: batch.status });
  }

  if (!batch.google_campaign_id) await attachBrandCampaign(batch.id, campaign);

  await runOrThrow("explorer:preflight", () => explorerPreflightCommand({ batch: batch!.id }));
  const writeHash = await computeWritePlanHash(batch.id);
  await runOrThrow("explorer:merchant:apply", () =>
    explorerMerchantApplyCommand({ batch: batch!.id, confirm: writeHash })
  );
  const outbox = await outboxCounts(batch.id);
  const bidOps = await enforceMaxCpc(config, campaign, opts.maxCpcMicros);
  await runOrThrow("explorer:activate", () =>
    explorerActivateCommand({ batch: batch!.id, confirm: batch!.plan_hash })
  );

  return {
    brand,
    action: "activated",
    batchId: batch.id,
    campaignId: campaign.campaignId,
    campaignName: campaign.campaignName,
    outbox,
    bidOps,
  };
}

/**
 * Rolling Explorer for the brand PMax campaigns: whenever a brand has no open batch, plan,
 * label and activate the next one. Reconcile closes batches after `batchDays`, so with a
 * frequent timer a new round starts within hours of the previous one ending.
 */
export async function explorerBrandCycleCommand(
  options: ExplorerBrandCycleOptions = {}
): Promise<number> {
  return withSyncRun("explorer:brand:cycle", options, async () => {
    const brands = (options.brands?.trim() || Object.keys(BRAND_SOURCE_CAMPAIGNS).join(","))
      .split(",")
      .map((b) => b.trim().toLowerCase())
      .filter(Boolean);
    for (const b of brands) {
      if (!BRAND_SOURCE_CAMPAIGNS[b]) {
        throw new Error(`Unknown brand ${b}; expected one of ${Object.keys(BRAND_SOURCE_CAMPAIGNS).join(", ")}`);
      }
    }
    const opts = {
      models: Math.max(1, Math.floor(options.models ?? DEFAULT_MODELS)),
      batchDays: options.batchDays && options.batchDays > 0 ? options.batchDays : DEFAULT_BATCH_DAYS,
      maxCpcMicros: options.maxCpcMicros ?? DEFAULT_MAX_CPC_MICROS,
      dryRun: options.dryRun === true,
    };

    const authExit = await authHealthCommand();
    if (authExit !== EXIT_OK) throw new Error(`auth:health exited with code ${authExit}`);
    const config = resolveAdsConfig();

    const outcomes: BrandOutcome[] = [];
    const errors: Array<{ brand: string; message: string }> = [];
    for (const brand of brands) {
      try {
        const outcome = await runBrand(brand, opts, config);
        outcomes.push(outcome);
        log("explorer_brand_cycle.brand_done", outcome);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ brand, message });
        log("explorer_brand_cycle.brand_failed", { brand, message });
      }
    }

    const report = { options: opts, outcomes, errors };
    const reportPath = await writeExplorerReport(
      `explorer-brand-cycle-${new Date().toISOString().slice(0, 10)}.json`,
      report
    );
    log("explorer_brand_cycle.summary", { ...report, reportPath });
    if (errors.length > 0) {
      throw new Error(`Brand cycle failed for ${errors.map((e) => e.brand).join(", ")}`);
    }
    return { ...report, reportPath };
  });
}
