import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { resolveAdsConfig } from "@/adsanalytics/config";
import { explorerPlanCommand, countExplorerPlanPool } from "@/adsanalytics/commands/explorerPlan";
import { explorerPreflightCommand } from "@/adsanalytics/commands/explorerPreflight";
import { explorerCoreExclusionsCommand } from "@/adsanalytics/commands/explorerCoreExclusions";
import { explorerMerchantPrepareCommand } from "@/adsanalytics/commands/explorerMerchantPrepare";
import { explorerMerchantApplyCommand } from "@/adsanalytics/commands/explorerMerchantApply";
import { explorerActivateCommand } from "@/adsanalytics/commands/explorerActivate";
import { explorerCampaignDiscoverCommand } from "@/adsanalytics/commands/explorerCampaignDiscover";
import { explorerCampaignRegisterCommand } from "@/adsanalytics/commands/explorerCampaignRegister";
import {
  loadCampaignRegistry,
  type CampaignRegistryRow,
} from "@/adsanalytics/explorer/campaignRegistry";
import {
  fetchCampaignFacts,
  listShoppingCampaignIds,
} from "@/adsanalytics/explorer/campaignInspect";
import { labelForDestination } from "@/adsanalytics/explorer/destinations";
import {
  loadOffersForBatchModels,
  planHashFromPayload,
  writeExplorerReport,
} from "@/adsanalytics/explorer/core";
import { EXIT_OK, log, withSyncRun } from "@/adsanalytics/run";

const SOURCE_CAMPAIGN_NAME = "all";
const EXPLORER_ROLE = "EXPLORER_ALL";
/** Weekly target; effective size is min(target, availablePool). */
const WEEKLY_TARGET_MODELS = 1000;
/** Below this pool size the weekly run skips instead of shipping a tiny batch. */
const WEEKLY_FLOOR_MODELS = 100;
/** Statuses that indicate a batch is not terminal — presence blocks re-planning. */
const NON_TERMINAL_STATUSES = [
  "planned",
  "ready",
  "running",
  "labeling",
  "active",
];

function isoWeekSeed(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  const yyyy = d.getUTCFullYear();
  const ww = String(weekNo).padStart(2, "0");
  return `weekly-${yyyy}W${ww}`;
}

type ExistingBatchRow = {
  id: string;
  status: string;
  plan_hash: string;
  google_campaign_id: string | null;
  created_at: string;
};

async function findExistingBatch(
  seed: string
): Promise<ExistingBatchRow | null> {
  const rows = await prisma.$queryRaw<ExistingBatchRow[]>(Prisma.sql`
    SELECT
      b."id",
      b."status",
      b."plan_hash",
      b."google_campaign_id",
      b."created_at"::text
    FROM "public"."ads_explorer_batches" b
    WHERE b."stats_json"->>'seed' = ${seed}
      AND b."stats_json"->>'sourceCampaignName' = ${SOURCE_CAMPAIGN_NAME}
      AND b."status" = ANY(${NON_TERMINAL_STATUSES}::text[])
    ORDER BY b."created_at" DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function findLatestBatchBySeed(seed: string): Promise<{
  id: string;
  status: string;
  plan_hash: string;
  google_campaign_id: string | null;
} | null> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; status: string; plan_hash: string; google_campaign_id: string | null }>
  >(Prisma.sql`
    SELECT b."id", b."status", b."plan_hash", b."google_campaign_id"
    FROM "public"."ads_explorer_batches" b
    WHERE b."stats_json"->>'seed' = ${seed}
      AND b."stats_json"->>'sourceCampaignName' = ${SOURCE_CAMPAIGN_NAME}
    ORDER BY b."created_at" DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function ensureExplorerCampaignRegistered(): Promise<CampaignRegistryRow> {
  let registry = await loadCampaignRegistry();
  let row = registry.get(EXPLORER_ROLE);
  if (row) return row;

  log("explorer_weekly.discover_explorer_campaign", { role: EXPLORER_ROLE });
  const discoverExit = await explorerCampaignDiscoverCommand({ role: EXPLORER_ROLE });
  if (discoverExit !== EXIT_OK) {
    throw new Error(`explorer:campaign:discover failed with exit code ${discoverExit}`);
  }

  const config = resolveAdsConfig();
  const campaignIds = await listShoppingCampaignIds(config);
  const facts = await fetchCampaignFacts(config, campaignIds);
  const label = labelForDestination("EXPLORER_ALL");
  if (!label) throw new Error("EXPLORER_ALL has no include label defined");
  const matches = [...facts.values()].filter((c) =>
    c.includedCustomLabel3.includes(label)
  );
  if (matches.length === 0) {
    throw new Error(
      `No Ads campaign targets custom_label_3=${label}. Create the Explorer | Long Tail | CH campaign first.`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous: ${matches.length} Ads campaigns target custom_label_3=${label}: ${matches
        .map((m) => `${m.campaignId} (${m.campaignName})`)
        .join(", ")}`
    );
  }
  const found = matches[0]!;
  log("explorer_weekly.register_explorer_campaign", {
    role: EXPLORER_ROLE,
    campaignId: found.campaignId,
    campaignName: found.campaignName,
  });
  const regExit = await explorerCampaignRegisterCommand({
    role: EXPLORER_ROLE,
    campaignId: found.campaignId,
  });
  if (regExit !== EXIT_OK) {
    throw new Error(`explorer:campaign:register failed with exit code ${regExit}`);
  }
  registry = await loadCampaignRegistry();
  row = registry.get(EXPLORER_ROLE);
  if (!row) throw new Error("EXPLORER_ALL still missing from registry after register.");
  return row;
}

async function attachCampaignToBatch(
  batchId: string,
  campaign: CampaignRegistryRow
): Promise<void> {
  if (!campaign.campaignId) throw new Error("Registry row has no campaignId");
  if (!campaign.adGroupResourceName) {
    throw new Error(
      `Explorer campaign ${campaign.campaignId} has no ad_group_resource_name in registry — activation would fail.`
    );
  }
  if (!campaign.adGroupAdResourceName) {
    throw new Error(
      `Explorer campaign ${campaign.campaignId} has no ad_group_ad_resource_name in registry — activation would fail.`
    );
  }
  const customerId = resolveAdsConfig().customerId;
  const campaignResourceName =
    campaign.campaignResourceName ?? `customers/${customerId}/campaigns/${campaign.campaignId}`;
  const patch = {
    weeklyAttachedAt: new Date().toISOString(),
    reusedRole: EXPLORER_ROLE,
    explorerCampaign: {
      campaignId: campaign.campaignId,
      campaignResourceName,
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

async function computeWritePlanHash(batchId: string): Promise<string> {
  const offers = await loadOffersForBatchModels(batchId);
  if (offers.length === 0) throw new Error(`No offers found for batch ${batchId}`);
  const writes = offers.map((o) => ({
    shopifyProductId: o.shopifyProductId,
    offerId: o.offerId,
    languageCode: o.languageCode,
    feedLabel: o.feedLabel,
  }));
  return planHashFromPayload({
    batchId,
    operation: "insert",
    writes: writes.map((w) => ({
      product: w.shopifyProductId,
      offerId: w.offerId,
      lang: w.languageCode,
      feed: w.feedLabel,
    })),
  });
}

async function outboxCounts(batchId: string): Promise<{
  total: number;
  pending: number;
  succeeded: number;
  failed: number;
}> {
  const rows = await prisma.$queryRaw<Array<{ status: string; n: number }>>(Prisma.sql`
    SELECT "status", COUNT(*)::int AS n
    FROM "public"."ads_explorer_offer_writes"
    WHERE "batch_id" = ${batchId} AND "operation" = 'insert'
    GROUP BY "status"
  `);
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  const pending = Number(by.pending ?? 0);
  const succeeded = Number(by.succeeded ?? 0);
  const failed = Number(by.failed ?? 0);
  return { total: pending + succeeded + failed, pending, succeeded, failed };
}

async function runOrThrow(
  name: string,
  fn: () => Promise<number>
): Promise<void> {
  const exit = await fn();
  if (exit !== EXIT_OK) {
    throw new Error(`${name} exited with code ${exit}`);
  }
}

export async function explorerWeeklyPlanCommand(): Promise<number> {
  return withSyncRun("explorer:weekly:plan", {}, async () => {
    const seed = isoWeekSeed();
    log("explorer_weekly.start", { seed });

    const existing = await findExistingBatch(seed);
    if (existing) {
      log("explorer_weekly.skip_existing", {
        seed,
        batchId: existing.id,
        status: existing.status,
      });
      return {
        skipped: true,
        reason: "existing_active_batch",
        seed,
        batchId: existing.id,
        status: existing.status,
      };
    }

    const explorerCampaign = await ensureExplorerCampaignRegistered();

    const pool = await countExplorerPlanPool({
      days: 30,
      requireRoutingClean: true,
      sourceCampaignName: SOURCE_CAMPAIGN_NAME,
      requireEmptyCustomLabel3: true,
    });
    if (pool < WEEKLY_FLOOR_MODELS) {
      log("explorer_weekly.skip_low_pool", {
        seed,
        pool,
        floor: WEEKLY_FLOOR_MODELS,
        target: WEEKLY_TARGET_MODELS,
      });
      return {
        skipped: true,
        reason: "low_pool",
        seed,
        pool,
        floor: WEEKLY_FLOOR_MODELS,
        target: WEEKLY_TARGET_MODELS,
      };
    }
    const effectiveModels = Math.min(WEEKLY_TARGET_MODELS, pool);
    log("explorer_weekly.pool", {
      seed,
      pool,
      target: WEEKLY_TARGET_MODELS,
      effectiveModels,
    });

    await runOrThrow("explorer:plan", () =>
      explorerPlanCommand({
        models: effectiveModels,
        days: 30,
        seed,
        requireRoutingClean: true,
        sourceCampaignName: SOURCE_CAMPAIGN_NAME,
        requireEmptyCustomLabel3: true,
        abortForbiddenBrands: true,
      })
    );

    const batch = await findLatestBatchBySeed(seed);
    if (!batch) {
      throw new Error(`Batch missing after explorer:plan for seed=${seed}`);
    }
    log("explorer_weekly.batch_created", { batchId: batch.id, planHash: batch.plan_hash });

    await attachCampaignToBatch(batch.id, explorerCampaign);
    log("explorer_weekly.campaign_attached", {
      batchId: batch.id,
      googleCampaignId: explorerCampaign.campaignId,
    });

    await runOrThrow("explorer:preflight", () =>
      explorerPreflightCommand({ batch: batch.id })
    );

    await runOrThrow("explorer:core-exclusions --validate-only", () =>
      explorerCoreExclusionsCommand({
        batch: batch.id,
        validateOnly: true,
        allowOnlySourceCampaignName: SOURCE_CAMPAIGN_NAME,
      })
    );

    await runOrThrow("explorer:merchant:prepare", () =>
      explorerMerchantPrepareCommand({ batch: batch.id })
    );

    const writeHash = await computeWritePlanHash(batch.id);
    await runOrThrow("explorer:merchant:apply", () =>
      explorerMerchantApplyCommand({ batch: batch.id, confirm: writeHash })
    );
    const outbox = await outboxCounts(batch.id);
    log("explorer_weekly.merchant_apply_done", { batchId: batch.id, writeHash, outbox });

    await runOrThrow("explorer:activate", () =>
      explorerActivateCommand({ batch: batch.id, confirm: batch.plan_hash })
    );

    const report = {
      seed,
      batchId: batch.id,
      planHash: batch.plan_hash,
      writePlanHash: writeHash,
      googleCampaignId: explorerCampaign.campaignId,
      explorerCampaign: {
        role: explorerCampaign.role,
        campaignId: explorerCampaign.campaignId,
        campaignName: explorerCampaign.campaignName,
      },
      outbox,
    };
    const reportPath = await writeExplorerReport(
      `explorer-weekly-${batch.id}.json`,
      report
    );
    log("explorer_weekly.summary", { ...report, reportPath });
    return { ...report, reportPath, skipped: false };
  });
}
