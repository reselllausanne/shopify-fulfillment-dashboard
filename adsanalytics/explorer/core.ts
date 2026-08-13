import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { resolveAdsConfig } from "@/adsanalytics/config";
import { addDays, defaultEndDate } from "@/adsanalytics/dates";
import { searchAll } from "@/adsanalytics/google/adsClient";
import {
  pmaxCampaignSettingsQuery,
  pmaxListingGroupFilterTreeQuery,
} from "@/adsanalytics/google/queries";
import { ROUTED_LABELS } from "@/adsanalytics/explorer/labels";
import { stringifySafe } from "@/adsanalytics/json";
import {
  campaignListingNodes,
  leafPath,
  mapListingFilterRow,
  offerMatchesListingRules,
  resolveIncludedLeafNodesForOffer,
  reconstructEffectiveRules,
  type ListingFilterNode,
  type OfferAttrs,
} from "@/adsanalytics/listingGroup";

export const EXPLORER_GROSS_MARGIN = 0.3035;
export const EXPLORER_BREAK_EVEN_ROAS = 1 / EXPLORER_GROSS_MARGIN;
export const EXPLORER_TARGET_ROAS = 5;
export const EXPLORER_DEFAULT_BUDGET_MICROS = 50_000_000;
export const EXPLORER_DEFAULT_MAX_CPC_MICROS = 200_000; // CHF 0.20
export const EXPLORER_DEFAULT_BATCH_DAYS = 10;
export const EXPLORER_DEFAULT_FEED_LABEL = "CH";
export const EXPLORER_DEFAULT_MERCHANT_ID = "669442699";
export const EXPLORER_ALLOWED_LANGUAGES = ["en", "de", "fr"] as const;
export const EXPLORER_OPS_DAILY_LIMIT = 2880;

/** remove leaf + create subdivision + one UNIT_EXCLUDED per routed label + everything-else. */
export const LEAF_SUBDIVISION_OPS = 3 + ROUTED_LABELS.length;

export type ExplorerCampaign = {
  campaignId: string;
  campaignName: string;
  status: string;
  merchantId: string | null;
  feedLabel: string | null;
  targetRoas: number | null;
  budgetMicros: string | null;
};

export type CandidateOffer = OfferAttrs & {
  merchantId: string;
  channel: string;
  languageCode: string;
  feedLabel: string;
  status: string;
  availability: string;
  shopifyProductId: string;
  shopifyVariantId: string | null;
};

export type CandidateModel = {
  shopifyProductId: string;
  brand: string;
  eligibleOfferCount: number;
  impressions30d: number;
  conversionsAllTime: number;
  shopifySales365: number;
  productCreatedAtProxy: string;
};

export type ModelSourceMapping = {
  shopifyProductId: string;
  sourceCampaignId: string;
  sourceCampaignName: string;
  brand: string;
  offerCount: number;
};

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function section(row: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = row[key];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function writeExplorerReport(name: string, data: unknown): Promise<string> {
  const outDir = path.join(process.cwd(), "tmp", "explorer");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, name);
  await writeFile(outPath, stringifySafe(data), "utf8");
  return outPath;
}

export function planHashFromPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

export function deterministicScore(seed: string, modelId: string): string {
  return createHash("sha256").update(`${seed}|${modelId}`).digest("hex");
}

export async function loadExplorerCampaignsAndListingNodes(): Promise<{
  campaigns: ExplorerCampaign[];
  listingNodes: ListingFilterNode[];
}> {
  const config = resolveAdsConfig();
  const [settingsRes, treeRes] = await Promise.all([
    searchAll(config, pmaxCampaignSettingsQuery()),
    searchAll(config, pmaxListingGroupFilterTreeQuery()),
  ]);

  const campaigns = settingsRes.rows
    .map((row) => {
      const campaign = section(row, "campaign");
      const shopping = section(campaign, "shoppingSetting");
      const budget = section(row, "campaignBudget");
      const mcv = section(campaign, "maximizeConversionValue");
      const targetRoasRaw = mcv.targetRoas;
      return {
        campaignId: asString(campaign.id),
        campaignName: asString(campaign.name),
        status: asString(campaign.status),
        merchantId: asString(shopping.merchantId) || null,
        feedLabel: asString(shopping.feedLabel) || null,
        targetRoas:
          targetRoasRaw == null || targetRoasRaw === "" ? null : Number(targetRoasRaw),
        budgetMicros: asString(budget.amountMicros) || null,
      };
    })
    .filter((c) => c.campaignId.length > 0 && c.status === "ENABLED")
    .sort((a, b) => a.campaignName.localeCompare(b.campaignName));

  const listingNodes = treeRes.rows
    .map((row) => mapListingFilterRow(row))
    .filter((row): row is ListingFilterNode => row != null);

  return { campaigns, listingNodes };
}

export async function loadBaseCandidates(
  lookbackDays: number
): Promise<CandidateModel[]> {
  const debug = await computeExplorerEligibilityDebug(lookbackDays);
  return debug.finalCandidates.map((r) => ({
    shopifyProductId: r.shopifyProductId,
    brand: r.brand,
    eligibleOfferCount: r.offerCount,
    impressions30d: r.impressions30d,
    conversionsAllTime: r.conversionsAllTime,
    shopifySales365: r.shopifySales365,
    productCreatedAtProxy: r.shopifyCreatedAt ?? "",
  }));
}

type EligibilityModelRow = {
  shopifyProductId: string;
  brand: string;
  offerCount: number;
  hasValidOfferId: boolean;
  hasValidLanguage: boolean;
  hasValidFeedLabel: boolean;
  approved: boolean;
  inStock: boolean;
  impressions30d: number;
  conversionsAllTime: number;
  shopifySales365: number;
  shopifyCreatedAt: string | null;
  sourceCampaignCount: number;
  sourceCampaignNames: string[];
  inActiveBatch: boolean;
  inCooldown: boolean;
};

export function simulateEligibilityWaterfall(
  rows: EligibilityModelRow[],
  createdAtFieldAvailable = true
): EligibilityModelRow[] {
  let current = rows.slice();
  const keep = (fn: (row: EligibilityModelRow) => boolean) => {
    current = current.filter(fn);
  };
  keep((m) => Boolean(m.shopifyProductId));
  keep((m) => m.offerCount > 0);
  keep((m) => m.approved);
  keep((m) => m.inStock);
  if (createdAtFieldAvailable) {
    keep((m) => Boolean(m.shopifyCreatedAt) && new Date(m.shopifyCreatedAt!).getTime() <= Date.now() - 30 * 86400_000);
  }
  keep((m) => (m.impressions30d ?? 0) === 0);
  keep((m) => (m.conversionsAllTime ?? 0) === 0);
  keep((m) => (m.shopifySales365 ?? 0) === 0);
  keep((m) => m.sourceCampaignCount >= 1);
  keep((m) => m.sourceCampaignCount === 1);
  keep((m) => m.hasValidOfferId);
  keep((m) => m.hasValidLanguage);
  keep((m) => m.hasValidFeedLabel);
  keep((m) => !m.inActiveBatch);
  keep((m) => !m.inCooldown);
  return current;
}

export type ExplorerEligibilityDebug = {
  lookbackDays: number;
  generatedAt: string;
  fieldAvailability: Record<string, { available: boolean; proxy?: string; note?: string }>;
  waterfall: Array<{
    step: string;
    before: number;
    after: number;
    rejected: number;
    lossPct: number;
    rejectionReason: string;
    rejectionExamples: Array<Record<string, unknown>>;
  }>;
  independentRuleFailures: Record<string, { failing: number; passing: number }>;
  nullCounts: Record<string, number>;
  campaignSourceCountDistribution: { zero: number; one: number; twoPlus: number };
  zeroImpressionFromInventory: number;
  knownReferenceZeroImpression: number;
  finalCandidates: EligibilityModelRow[];
};

function sanitizeEligibilityExample(row: EligibilityModelRow): Record<string, unknown> {
  return {
    model: row.shopifyProductId,
    brand: row.brand,
    offerCount: row.offerCount,
    approved: row.approved,
    inStock: row.inStock,
    impressions30d: row.impressions30d,
    conversionsAllTime: row.conversionsAllTime,
    shopifySales365: row.shopifySales365,
    sourceCampaignCount: row.sourceCampaignCount,
    hasValidOfferId: row.hasValidOfferId,
    hasValidLanguage: row.hasValidLanguage,
    hasValidFeedLabel: row.hasValidFeedLabel,
  };
}

export async function computeExplorerEligibilityDebug(
  lookbackDays: number
): Promise<ExplorerEligibilityDebug> {
  const end = defaultEndDate();
  const start = addDays(end, -(lookbackDays - 1));

  const inventoryOfferCounts = await prisma.$queryRaw<
    Array<{ total_offers: number; offers_with_model: number; models_with_id: number }>
  >(Prisma.sql`
    SELECT
      COUNT(*)::int AS total_offers,
      COUNT(*) FILTER (WHERE "shopify_product_id" IS NOT NULL)::int AS offers_with_model,
      COUNT(DISTINCT "shopify_product_id") FILTER (WHERE "shopify_product_id" IS NOT NULL)::int AS models_with_id
    FROM "public"."ads_shopping_product_current"
    WHERE "is_current" = true
      AND "merchant_id" = ${EXPLORER_DEFAULT_MERCHANT_ID}::bigint
  `);

  const baseRows = await prisma.$queryRaw<
    Array<{
      shopify_product_id: string;
      brand: string;
      offer_count: number;
      has_valid_offer_id: boolean;
      has_valid_language: boolean;
      has_valid_feed_label: boolean;
      approved: boolean;
      in_stock: boolean;
    }>
  >(Prisma.sql`
    SELECT
      "shopify_product_id"::text AS shopify_product_id,
      COALESCE(MAX(NULLIF("brand", '')), '(empty)') AS brand,
      COUNT(*)::int AS offer_count,
      BOOL_OR(COALESCE(NULLIF("offer_id", ''), '') <> '') AS has_valid_offer_id,
      BOOL_OR(LOWER(COALESCE("language_code", '')) IN (${Prisma.join(EXPLORER_ALLOWED_LANGUAGES)})) AS has_valid_language,
      BOOL_OR(UPPER(COALESCE("feed_label", '')) = ${EXPLORER_DEFAULT_FEED_LABEL}) AS has_valid_feed_label,
      BOOL_OR(UPPER(COALESCE("status", '')) = 'ELIGIBLE') AS approved,
      BOOL_OR(UPPER(COALESCE("availability", '')) = 'IN_STOCK') AS in_stock
    FROM "public"."ads_shopping_product_current"
    WHERE "is_current" = true
      AND "merchant_id" = ${EXPLORER_DEFAULT_MERCHANT_ID}::bigint
      AND "shopify_product_id" IS NOT NULL
    GROUP BY "shopify_product_id"
  `);

  const ads30Rows = await prisma.$queryRaw<Array<{ shopify_product_id: string; impressions_30d: number }>>(
    Prisma.sql`
      SELECT
        "shopify_product_id"::text AS shopify_product_id,
        COALESCE(SUM("impressions"), 0)::float8 AS impressions_30d
      FROM "public"."ads_product_daily"
      WHERE "shopify_product_id" IS NOT NULL
        AND "date" BETWEEN ${start}::date AND ${end}::date
      GROUP BY "shopify_product_id"
    `
  );
  const adsAllRows = await prisma.$queryRaw<Array<{ shopify_product_id: string; conversions_all_time: number }>>(
    Prisma.sql`
      SELECT
        "shopify_product_id"::text AS shopify_product_id,
        COALESCE(SUM("conversions"), 0)::float8 AS conversions_all_time
      FROM "public"."ads_product_daily"
      WHERE "shopify_product_id" IS NOT NULL
      GROUP BY "shopify_product_id"
    `
  );
  const ageRows = await prisma.$queryRaw<Array<{ shopify_product_id: string; created_at: string }>>(Prisma.sql`
    SELECT
      "shopify_product_id"::text AS shopify_product_id,
      "shopify_product_created_at"::text AS created_at
    FROM "public"."ads_explorer_product_age"
    WHERE "shopify_product_created_at" IS NOT NULL
  `);
  const salesRows = await prisma.$queryRaw<Array<{ shopify_product_id: string; sales_365: number }>>(Prisma.sql`
    SELECT
      src."shopify_product_id"::text AS shopify_product_id,
      COUNT(*)::int AS sales_365
    FROM "public"."ads_shopping_product_current" src
    JOIN "public"."ChannelListingState" cls
      ON cls."channel" = 'SHOPIFY'
     AND cls."externalVariantId" = src."shopify_variant_id"::text
     AND cls."supplierVariantId" IS NOT NULL
    JOIN "public"."InventoryEvent" ie
      ON ie."supplierVariantId" = cls."supplierVariantId"
     AND ie."channel" = 'SHOPIFY'
     AND ie."eventType" = 'SALE'
     AND ie."occurredAt" >= (CURRENT_TIMESTAMP - INTERVAL '365 day')
    WHERE src."is_current" = true
      AND src."merchant_id" = ${EXPLORER_DEFAULT_MERCHANT_ID}::bigint
      AND src."shopify_product_id" IS NOT NULL
    GROUP BY src."shopify_product_id"
  `);
  const blockedRows = await prisma.$queryRaw<
    Array<{ shopify_product_id: string; in_active_batch: boolean; in_cooldown: boolean }>
  >(Prisma.sql`
    SELECT
      "shopify_product_id"::text AS shopify_product_id,
      BOOL_OR("lifecycle_status" IN ('selected','labeling','active')) AS in_active_batch,
      BOOL_OR(
        "exit_reason" = 'exposed_no_click'
        AND "exited_at" >= (CURRENT_TIMESTAMP - INTERVAL '60 day')
      ) AS in_cooldown
    FROM "public"."ads_explorer_batch_models"
    GROUP BY "shopify_product_id"
  `);

  const ads30Map = new Map(ads30Rows.map((r) => [r.shopify_product_id, r.impressions_30d]));
  const adsAllMap = new Map(adsAllRows.map((r) => [r.shopify_product_id, r.conversions_all_time]));
  const ageMap = new Map(ageRows.map((r) => [r.shopify_product_id, r.created_at]));
  const salesMap = new Map(salesRows.map((r) => [r.shopify_product_id, r.sales_365]));
  const blockedMap = new Map(
    blockedRows.map((r) => [r.shopify_product_id, { active: r.in_active_batch, cooldown: r.in_cooldown }])
  );

  const models: EligibilityModelRow[] = baseRows.map((r) => ({
    shopifyProductId: r.shopify_product_id,
    brand: r.brand,
    offerCount: r.offer_count,
    hasValidOfferId: r.has_valid_offer_id,
    hasValidLanguage: r.has_valid_language,
    hasValidFeedLabel: r.has_valid_feed_label,
    approved: r.approved,
    inStock: r.in_stock,
    impressions30d: Number(ads30Map.get(r.shopify_product_id) ?? 0),
    conversionsAllTime: Number(adsAllMap.get(r.shopify_product_id) ?? 0),
    shopifySales365: Number(salesMap.get(r.shopify_product_id) ?? 0),
    shopifyCreatedAt: ageMap.get(r.shopify_product_id) ?? null,
    sourceCampaignCount: 0,
    sourceCampaignNames: [],
    inActiveBatch: blockedMap.get(r.shopify_product_id)?.active ?? false,
    inCooldown: blockedMap.get(r.shopify_product_id)?.cooldown ?? false,
  }));

  // Source campaign mapping from real listing trees (no shopping_product scope).
  const listingCtx = await loadExplorerCampaignsAndListingNodes();
  const sourceInputModelIds = models
    .filter(
      (m) =>
        m.offerCount > 0 &&
        m.approved &&
        m.inStock &&
        (m.shopifyCreatedAt ? new Date(m.shopifyCreatedAt).getTime() <= Date.now() - 30 * 86400_000 : true) &&
        m.impressions30d === 0 &&
        m.conversionsAllTime === 0 &&
        m.shopifySales365 === 0
    )
    .map((m) => m.shopifyProductId);

  const offersByModel = await loadCandidateOffersForModels(sourceInputModelIds);
  const campaignNodeMap = new Map(
    listingCtx.campaigns.map((c) => [c.campaignId, campaignListingNodes(listingCtx.listingNodes, c.campaignId)])
  );
  for (const modelId of sourceInputModelIds) {
    const row = models.find((m) => m.shopifyProductId === modelId);
    if (!row) continue;
    const offers = offersByModel.get(modelId) ?? [];
    const hits = new Set<string>();
    for (const offer of offers) {
      for (const campaign of listingCtx.campaigns) {
        const nodes = campaignNodeMap.get(campaign.campaignId) ?? [];
        if (offerMatchesListingRules(offer, nodes).included) hits.add(campaign.campaignId);
      }
    }
    row.sourceCampaignCount = hits.size;
    row.sourceCampaignNames = listingCtx.campaigns
      .filter((c) => hits.has(c.campaignId))
      .map((c) => c.campaignName);
  }

  const createdAtAvailableForPopulation = models.some((m) => Boolean(m.shopifyCreatedAt));
  const fieldAvailability = {
    approved: { available: true, proxy: "status=ELIGIBLE" },
    in_stock: { available: true, proxy: "availability=IN_STOCK" },
    shopify_created_at: createdAtAvailableForPopulation
      ? { available: true, proxy: "ShopifySyncState.createdAt" }
      : { available: false, note: "field_unavailable", proxy: "ShopifySyncState.createdAt" },
  };

  const zeroImpressionFromInventory = models.filter((m) => m.impressions30d === 0).length;

  const waterfall: ExplorerEligibilityDebug["waterfall"] = [];
  let current = models.slice();
  const pushStep = (
    step: string,
    reason: string,
    keep: (row: EligibilityModelRow) => boolean
  ) => {
    const before = current.length;
    const passed = current.filter(keep);
    const rejected = current.filter((r) => !keep(r));
    const after = passed.length;
    const lossPct = before > 0 ? Number((((before - after) / before) * 100).toFixed(4)) : 0;
    waterfall.push({
      step,
      before,
      after,
      rejected: before - after,
      lossPct,
      rejectionReason: reason,
      rejectionExamples: rejected.slice(0, 20).map((r) => sanitizeEligibilityExample(r)),
    });
    current = passed;
  };

  waterfall.push({
    step: "models_inventory_current",
    before: inventoryOfferCounts[0]?.models_with_id ?? models.length,
    after: models.length,
    rejected: 0,
    lossPct: 0,
    rejectionReason: "base_population",
    rejectionExamples: [],
  });
  pushStep("with_shopify_product_id", "shopify_product_id_missing", (m) => Boolean(m.shopifyProductId));
  pushStep("with_at_least_one_active_offer", "no_active_offer", (m) => m.offerCount > 0);
  pushStep("approved", "not_approved", (m) => m.approved);
  pushStep("in_stock", "not_in_stock", (m) => m.inStock);
  if (fieldAvailability.shopify_created_at.available) {
    pushStep("shopify_created_at_gte_30_days", "created_at_lt_30d_or_missing", (m) =>
      m.shopifyCreatedAt ? new Date(m.shopifyCreatedAt).getTime() <= Date.now() - 30 * 86400_000 : false
    );
  } else {
    waterfall.push({
      step: "shopify_created_at_gte_30_days",
      before: current.length,
      after: current.length,
      rejected: 0,
      lossPct: 0,
      rejectionReason: "field_unavailable",
      rejectionExamples: [],
    });
  }
  pushStep("impressions_30d_eq_0", "impressions_gt_0", (m) => m.impressions30d === 0);
  pushStep("ads_conversions_all_time_eq_0", "conversions_gt_0", (m) => m.conversionsAllTime === 0);
  pushStep("shopify_sales_365_eq_0", "shopify_sales_gt_0", (m) => m.shopifySales365 === 0);
  pushStep("source_campaign_found", "source_campaign_count_0", (m) => m.sourceCampaignCount >= 1);
  pushStep("exactly_one_source_campaign", "source_campaign_count_not_1", (m) => m.sourceCampaignCount === 1);
  pushStep("offer_with_valid_offer_id", "missing_valid_offer_id", (m) => m.hasValidOfferId);
  pushStep("content_language_valid", "missing_valid_language", (m) => m.hasValidLanguage);
  pushStep("feed_label_valid", "missing_valid_feed_label", (m) => m.hasValidFeedLabel);
  pushStep("absent_active_batch", "present_in_active_batch", (m) => !m.inActiveBatch);
  pushStep("absent_cooldown", "present_in_cooldown", (m) => !m.inCooldown);
  waterfall.push({
    step: "final_candidates",
    before: current.length,
    after: current.length,
    rejected: 0,
    lossPct: 0,
    rejectionReason: "final",
    rejectionExamples: [],
  });

  const sourceDistributionRows = models.filter((m) => m.sourceCampaignCount >= 0);
  const campaignSourceCountDistribution = {
    zero: sourceDistributionRows.filter((m) => m.sourceCampaignCount === 0).length,
    one: sourceDistributionRows.filter((m) => m.sourceCampaignCount === 1).length,
    twoPlus: sourceDistributionRows.filter((m) => m.sourceCampaignCount >= 2).length,
  };

  const independentRuleFailures: ExplorerEligibilityDebug["independentRuleFailures"] = {
    approved: {
      failing: models.filter((m) => !m.approved).length,
      passing: models.filter((m) => m.approved).length,
    },
    in_stock: {
      failing: models.filter((m) => !m.inStock).length,
      passing: models.filter((m) => m.inStock).length,
    },
    shopify_created_at_gte_30d: {
      failing: createdAtAvailableForPopulation
        ? models.filter((m) => {
            const createdAt = m.shopifyCreatedAt;
            return !createdAt || new Date(createdAt).getTime() > Date.now() - 30 * 86400_000;
          }).length
        : 0,
      passing: createdAtAvailableForPopulation
        ? models.filter((m) => {
            const createdAt = m.shopifyCreatedAt;
            if (!createdAt) return false;
            return new Date(createdAt).getTime() <= Date.now() - 30 * 86400_000;
          }).length
        : models.length,
    },
    impressions_30d_eq_0: {
      failing: models.filter((m) => m.impressions30d !== 0).length,
      passing: models.filter((m) => m.impressions30d === 0).length,
    },
    ads_conversions_hist_eq_0: {
      failing: models.filter((m) => m.conversionsAllTime !== 0).length,
      passing: models.filter((m) => m.conversionsAllTime === 0).length,
    },
    shopify_sales_365_eq_0: {
      failing: models.filter((m) => m.shopifySales365 !== 0).length,
      passing: models.filter((m) => m.shopifySales365 === 0).length,
    },
    source_campaign_count_eq_1: {
      failing: models.filter((m) => m.sourceCampaignCount !== 1).length,
      passing: models.filter((m) => m.sourceCampaignCount === 1).length,
    },
  };

  const nullCounts = {
    shopify_created_at_null: models.filter((m) => !m.shopifyCreatedAt).length,
    impressions_ads_row_missing: models.filter((m) => !ads30Map.has(m.shopifyProductId)).length,
    conversions_ads_row_missing: models.filter((m) => !adsAllMap.has(m.shopifyProductId)).length,
    shopify_sales_row_missing: models.filter((m) => !salesMap.has(m.shopifyProductId)).length,
    source_campaign_not_evaluated: models.filter((m) => m.sourceCampaignCount === 0).length,
  };

  return {
    lookbackDays,
    generatedAt: new Date().toISOString(),
    fieldAvailability,
    waterfall,
    independentRuleFailures,
    nullCounts,
    campaignSourceCountDistribution,
    zeroImpressionFromInventory,
    knownReferenceZeroImpression: 31_941,
    finalCandidates: current,
  };
}

export async function loadCandidateOffersForModels(
  modelIds: string[]
): Promise<Map<string, CandidateOffer[]>> {
  const byModel = new Map<string, CandidateOffer[]>();
  if (modelIds.length === 0) return byModel;
  for (const batch of chunk(modelIds, 1000)) {
    const rows = await prisma.$queryRaw<
      Array<{
        merchant_id: string;
        channel: string;
        language_code: string;
        feed_label: string;
        status: string;
        availability: string;
        offer_id: string;
        brand: string;
        product_type: string;
        custom_attr0: string;
        custom_attr1: string;
        custom_attr2: string;
        custom_attr3: string;
        custom_attr4: string;
        shopify_product_id: string;
        shopify_variant_id: string | null;
      }>
    >(Prisma.sql`
      SELECT
        "merchant_id"::text,
        "channel",
        "language_code",
        "feed_label",
        "status",
        "availability",
        "offer_id",
        COALESCE("brand", '') AS brand,
        COALESCE("product_type", '') AS product_type,
        COALESCE("custom_attr0", '') AS custom_attr0,
        COALESCE("custom_attr1", '') AS custom_attr1,
        COALESCE("custom_attr2", '') AS custom_attr2,
        COALESCE("custom_attr3", '') AS custom_attr3,
        COALESCE("custom_attr4", '') AS custom_attr4,
        "shopify_product_id"::text,
        "shopify_variant_id"::text
      FROM "public"."ads_shopping_product_current"
      WHERE "is_current" = true
        AND "shopify_product_id"::text IN (${Prisma.join(batch)})
        AND "merchant_id" = ${EXPLORER_DEFAULT_MERCHANT_ID}::bigint
        AND UPPER("feed_label") = ${EXPLORER_DEFAULT_FEED_LABEL}
        AND LOWER("language_code") IN (${Prisma.join(EXPLORER_ALLOWED_LANGUAGES)})
        AND UPPER("channel") = 'ONLINE'
        AND UPPER("status") = 'ELIGIBLE'
        AND UPPER("availability") = 'IN_STOCK'
    `);
    for (const row of rows) {
      const modelId = row.shopify_product_id;
      const list = byModel.get(modelId) ?? [];
      list.push({
        merchantId: row.merchant_id,
        channel: row.channel,
        languageCode: row.language_code,
        feedLabel: row.feed_label,
        status: row.status,
        availability: row.availability,
        offerId: row.offer_id,
        brand: row.brand,
        productType: row.product_type,
        customAttr0: row.custom_attr0,
        customAttr1: row.custom_attr1,
        customAttr2: row.custom_attr2,
        customAttr3: row.custom_attr3,
        customAttr4: row.custom_attr4,
        shopifyProductId: row.shopify_product_id,
        shopifyVariantId: row.shopify_variant_id,
      });
      byModel.set(modelId, list);
    }
  }
  return byModel;
}

export function mapModelToSingleSourceCampaign(
  models: CandidateModel[],
  offersByModel: Map<string, CandidateOffer[]>,
  campaigns: ExplorerCampaign[],
  listingNodes: ListingFilterNode[]
): {
  mapped: ModelSourceMapping[];
  rejected: Array<{ shopifyProductId: string; reason: string; campaignCount: number; campaigns: string[] }>;
} {
  const mapped: ModelSourceMapping[] = [];
  const rejected: Array<{
    shopifyProductId: string;
    reason: string;
    campaignCount: number;
    campaigns: string[];
  }> = [];

  for (const model of models) {
    const offers = offersByModel.get(model.shopifyProductId) ?? [];
    if (offers.length === 0) {
      rejected.push({
        shopifyProductId: model.shopifyProductId,
        reason: "no_exploitable_offer_rows",
        campaignCount: 0,
        campaigns: [],
      });
      continue;
    }
    const campaignHits = new Set<string>();
    for (const offer of offers) {
      for (const campaign of campaigns) {
        const nodes = campaignListingNodes(listingNodes, campaign.campaignId);
        const match = offerMatchesListingRules(offer, nodes);
        if (match.included) campaignHits.add(campaign.campaignId);
      }
    }
    if (campaignHits.size !== 1) {
      const names = campaigns
        .filter((c) => campaignHits.has(c.campaignId))
        .map((c) => c.campaignName);
      rejected.push({
        shopifyProductId: model.shopifyProductId,
        reason: "source_campaign_not_exactly_one",
        campaignCount: campaignHits.size,
        campaigns: names,
      });
      continue;
    }
    const sourceCampaignId = [...campaignHits][0]!;
    const sourceCampaignName =
      campaigns.find((c) => c.campaignId === sourceCampaignId)?.campaignName ?? "(unknown)";
    mapped.push({
      shopifyProductId: model.shopifyProductId,
      sourceCampaignId,
      sourceCampaignName,
      brand: model.brand || "(empty)",
      offerCount: offers.length,
    });
  }

  return { mapped, rejected };
}

export const FORBIDDEN_EXPLORER_BRAND_TOKENS = [
  "nike",
  "adidas",
  "jordan",
  "vêtements",
  "vetements",
  "lego",
] as const;

export function textContainsForbiddenBrandToken(text: string): string | null {
  const hay = text.trim().toLowerCase();
  if (!hay) return null;
  for (const token of FORBIDDEN_EXPLORER_BRAND_TOKENS) {
    if (hay.includes(token)) return token;
  }
  return null;
}

export function filterModelsBySourceCampaignName(
  rows: ModelSourceMapping[],
  sourceCampaignName: string
): {
  kept: ModelSourceMapping[];
  rejected: Array<{ shopifyProductId: string; reason: string; sourceCampaignName: string }>;
} {
  const wanted = sourceCampaignName.trim();
  const kept: ModelSourceMapping[] = [];
  const rejected: Array<{ shopifyProductId: string; reason: string; sourceCampaignName: string }> = [];
  for (const row of rows) {
    if (row.sourceCampaignName === wanted) {
      kept.push(row);
      continue;
    }
    rejected.push({
      shopifyProductId: row.shopifyProductId,
      reason: "source_campaign_name_mismatch",
      sourceCampaignName: row.sourceCampaignName,
    });
  }
  return { kept, rejected };
}

export function filterModelsWithEmptyPrimaryCustomLabel3(
  rows: ModelSourceMapping[],
  offersByModel: Map<string, CandidateOffer[]>
): {
  kept: ModelSourceMapping[];
  rejected: Array<{ shopifyProductId: string; reason: string; offerId: string; customAttr3: string }>;
} {
  const kept: ModelSourceMapping[] = [];
  const rejected: Array<{ shopifyProductId: string; reason: string; offerId: string; customAttr3: string }> = [];
  for (const row of rows) {
    const offers = offersByModel.get(row.shopifyProductId) ?? [];
    const dirty = offers.find((o) => (o.customAttr3 ?? "").trim() !== "");
    if (dirty) {
      rejected.push({
        shopifyProductId: row.shopifyProductId,
        reason: "primary_custom_label_3_not_empty",
        offerId: dirty.offerId,
        customAttr3: dirty.customAttr3,
      });
      continue;
    }
    kept.push(row);
  }
  return { kept, rejected };
}

export function brandDistribution(rows: Array<{ brand: string }>): Array<{ brand: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const brand = row.brand || "(empty)";
    counts.set(brand, (counts.get(brand) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([brand, count]) => ({ brand, count }))
    .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand));
}

export function assertNoForbiddenBrandTokens(
  contexts: Array<{ where: string; text: string }>
): void {
  const hits = contexts
    .map((c) => {
      const token = textContainsForbiddenBrandToken(c.text);
      return token ? { where: c.where, text: c.text, token } : null;
    })
    .filter((x): x is { where: string; text: string; token: string } => x != null);
  if (hits.length === 0) return;
  const sample = hits
    .slice(0, 20)
    .map((h) => `${h.where}:${h.token}`)
    .join("; ");
  throw new Error(
    `Abort: forbidden brand token(s) detected (${hits.length}). Sample: ${sample}`
  );
}

export function evaluateRoutingCleanModels(
  rows: ModelSourceMapping[],
  offersByModel: Map<string, CandidateOffer[]>,
  campaigns: ExplorerCampaign[],
  listingNodes: ListingFilterNode[]
): {
  clean: ModelSourceMapping[];
  rejected: Array<{ shopifyProductId: string; reason: string; offerId: string; campaignCount: number }>;
} {
  const campaignNodeMap = new Map<string, ListingFilterNode[]>();
  for (const campaign of campaigns) {
    campaignNodeMap.set(campaign.campaignId, campaignListingNodes(listingNodes, campaign.campaignId));
  }
  const clean: ModelSourceMapping[] = [];
  const rejected: Array<{ shopifyProductId: string; reason: string; offerId: string; campaignCount: number }> = [];

  for (const row of rows) {
    const offers = offersByModel.get(row.shopifyProductId) ?? [];
    let bad: { reason: string; offerId: string; campaignCount: number } | null = null;
    for (const offer of offers) {
      const campaignMatches: string[] = [];
      for (const campaign of campaigns) {
        const nodes = campaignNodeMap.get(campaign.campaignId) ?? [];
        const resolved = resolveIncludedLeafNodesForOffer(offer, nodes);
        if (resolved.included && resolved.matchedIncludedLeafs.length > 0) {
          campaignMatches.push(campaign.campaignId);
        }
      }
      if (campaignMatches.length === 0) {
        bad = { reason: "eligible_offer_zero_included_leaf", offerId: offer.offerId, campaignCount: 0 };
        break;
      }
      if (campaignMatches.length > 1) {
        bad = {
          reason: "eligible_offer_multi_enabled_campaign",
          offerId: offer.offerId,
          campaignCount: campaignMatches.length,
        };
        break;
      }
    }
    if (bad) {
      rejected.push({
        shopifyProductId: row.shopifyProductId,
        reason: bad.reason,
        offerId: bad.offerId,
        campaignCount: bad.campaignCount,
      });
      continue;
    }
    clean.push(row);
  }

  return { clean, rejected };
}

function pickRoundRobinByBrand(
  rows: Array<ModelSourceMapping & { score: string }>,
  limit: number
): Array<ModelSourceMapping & { score: string }> {
  const byBrand = new Map<string, Array<ModelSourceMapping & { score: string }>>();
  for (const row of rows) {
    const key = row.brand || "(empty)";
    const list = byBrand.get(key) ?? [];
    list.push(row);
    byBrand.set(key, list);
  }
  for (const list of byBrand.values()) {
    list.sort((a, b) => a.score.localeCompare(b.score));
  }
  const brands = [...byBrand.keys()].sort();
  const picked: Array<ModelSourceMapping & { score: string }> = [];
  let guard = 0;
  while (picked.length < limit && guard < 10_000_000) {
    guard += 1;
    let progressed = false;
    for (const brand of brands) {
      if (picked.length >= limit) break;
      const list = byBrand.get(brand);
      if (!list || list.length === 0) continue;
      picked.push(list.shift()!);
      progressed = true;
    }
    if (!progressed) break;
  }
  return picked;
}

export function selectBatchModelsStratified(
  mapped: ModelSourceMapping[],
  batchSize: number,
  seed: string
): {
  selected: Array<ModelSourceMapping & { score: string }>;
  allocationByCampaign: Array<{
    sourceCampaignId: string;
    sourceCampaignName: string;
    population: number;
    quota: number;
    selected: number;
  }>;
} {
  const byCampaign = new Map<string, ModelSourceMapping[]>();
  for (const row of mapped) {
    const key = `${row.sourceCampaignId}|${row.sourceCampaignName}`;
    const list = byCampaign.get(key) ?? [];
    list.push(row);
    byCampaign.set(key, list);
  }
  const total = mapped.length || 1;

  // Initial proportional quotas.
  const quotaRows = [...byCampaign.entries()].map(([k, rows]) => {
    const [sourceCampaignId, sourceCampaignName] = k.split("|");
    const population = rows.length;
    const proportional = Math.floor((population / total) * batchSize);
    const minimum = population >= 20 ? 20 : population;
    const quota = Math.min(population, Math.max(minimum, proportional));
    return { sourceCampaignId, sourceCampaignName, population, quota };
  });

  let quotaSum = quotaRows.reduce((s, r) => s + r.quota, 0);
  // Trim if overshoot.
  while (quotaSum > batchSize) {
    const candidate = quotaRows
      .filter((r) => r.quota > Math.min(20, r.population))
      .sort((a, b) => b.quota - a.quota)[0];
    if (!candidate) break;
    candidate.quota -= 1;
    quotaSum -= 1;
  }
  // Fill if undershoot.
  while (quotaSum < batchSize) {
    const candidate = quotaRows
      .filter((r) => r.quota < r.population)
      .sort((a, b) => (b.population - b.quota) - (a.population - a.quota))[0];
    if (!candidate) break;
    candidate.quota += 1;
    quotaSum += 1;
  }

  const selected: Array<ModelSourceMapping & { score: string }> = [];
  for (const row of quotaRows) {
    const key = `${row.sourceCampaignId}|${row.sourceCampaignName}`;
    const rows = (byCampaign.get(key) ?? []).map((r) => ({
      ...r,
      score: deterministicScore(seed, r.shopifyProductId),
    }));
    const picked = pickRoundRobinByBrand(rows, row.quota);
    selected.push(...picked);
    row.quota = picked.length;
  }

  // Deterministic global order.
  selected.sort((a, b) => a.score.localeCompare(b.score));
  if (selected.length > batchSize) selected.length = batchSize;

  return {
    selected,
    allocationByCampaign: quotaRows.map((r) => ({
      ...r,
      selected: selected.filter((s) => s.sourceCampaignId === r.sourceCampaignId).length,
    })),
  };
}

export async function createBatchRecord(input: {
  status: string;
  modelCount: number;
  offerCount: number;
  dailyBudgetMicros: bigint;
  maxCpcMicros: bigint;
  endsAt: Date;
  planHash: string;
  statsJson: unknown;
  commandMeta?: Record<string, unknown>;
}): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "public"."ads_explorer_batches" (
      "id","status","model_count","offer_count","daily_budget_micros","max_cpc_micros",
      "planned_at","ends_at","plan_hash","stats_json","error","created_at","updated_at"
    )
    VALUES (
      ${id},
      ${input.status},
      ${input.modelCount}::int,
      ${input.offerCount}::int,
      ${input.dailyBudgetMicros.toString()}::bigint,
      ${input.maxCpcMicros.toString()}::bigint,
      CURRENT_TIMESTAMP,
      ${input.endsAt}::timestamptz,
      ${input.planHash},
      ${JSON.stringify(input.statsJson)}::jsonb,
      null,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `);
  return id;
}

export async function upsertBatchModels(
  batchId: string,
  selected: Array<ModelSourceMapping & { score: string }>
): Promise<void> {
  for (const rows of chunk(selected, 300)) {
    const values = rows.map((row) => Prisma.sql`(
      ${randomUUID()},
      ${batchId},
      ${row.shopifyProductId}::bigint,
      ${row.sourceCampaignId},
      ${row.sourceCampaignName},
      ${row.brand},
      'selected',
      ${row.offerCount}::int,
      null,
      null,
      null,
      0::bigint,
      0::bigint,
      0::bigint,
      0::numeric,
      0::numeric,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )`);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "public"."ads_explorer_batch_models" (
        "id","batch_id","shopify_product_id","source_campaign_id","source_campaign_name",
        "brand","lifecycle_status","active_offer_count","started_at","exited_at","exit_reason",
        "impressions","clicks","cost_micros","conversions","conversion_value","created_at","updated_at"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("batch_id","shopify_product_id") DO UPDATE SET
        "source_campaign_id" = EXCLUDED."source_campaign_id",
        "source_campaign_name" = EXCLUDED."source_campaign_name",
        "brand" = EXCLUDED."brand",
        "lifecycle_status" = EXCLUDED."lifecycle_status",
        "active_offer_count" = EXCLUDED."active_offer_count",
        "updated_at" = CURRENT_TIMESTAMP
    `);
  }
}

export async function loadBatchById(batchId: string): Promise<
  | {
      id: string;
      status: string;
      modelCount: number;
      offerCount: number;
      dailyBudgetMicros: string;
      maxCpcMicros: string;
      planHash: string;
      googleCampaignId: string | null;
      merchantDataSourceName: string | null;
      statsJson: unknown;
      activatedAt: string | null;
      endsAt: string | null;
    }
  | null
> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      status: string;
      model_count: number;
      offer_count: number;
      daily_budget_micros: string;
      max_cpc_micros: string;
      plan_hash: string;
      google_campaign_id: string | null;
      merchant_data_source_name: string | null;
      stats_json: unknown;
      activated_at: string | null;
      ends_at: string | null;
    }>
  >(Prisma.sql`
    SELECT
      "id","status","model_count","offer_count",
      "daily_budget_micros"::text,"max_cpc_micros"::text,
      "plan_hash","google_campaign_id","merchant_data_source_name","stats_json",
      "activated_at"::text,"ends_at"::text
    FROM "public"."ads_explorer_batches"
    WHERE "id" = ${batchId}
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    modelCount: row.model_count,
    offerCount: row.offer_count,
    dailyBudgetMicros: row.daily_budget_micros,
    maxCpcMicros: row.max_cpc_micros,
    planHash: row.plan_hash,
    googleCampaignId: row.google_campaign_id,
    merchantDataSourceName: row.merchant_data_source_name,
    statsJson: row.stats_json,
    activatedAt: row.activated_at,
    endsAt: row.ends_at,
  };
}

export async function loadBatchModelRows(batchId: string): Promise<
  Array<{
    shopifyProductId: string;
    sourceCampaignId: string;
    sourceCampaignName: string;
    brand: string;
    lifecycleStatus: string;
    activeOfferCount: number;
    impressions: number;
    clicks: number;
    costMicros: number;
    conversions: number;
    conversionValue: number;
  }>
> {
  const rows = await prisma.$queryRaw<
    Array<{
      shopify_product_id: string;
      source_campaign_id: string;
      source_campaign_name: string;
      brand: string;
      lifecycle_status: string;
      active_offer_count: number;
      impressions: number;
      clicks: number;
      cost_micros: number;
      conversions: number;
      conversion_value: number;
    }>
  >(Prisma.sql`
    SELECT
      "shopify_product_id"::text,
      "source_campaign_id",
      "source_campaign_name",
      "brand",
      "lifecycle_status",
      "active_offer_count",
      COALESCE("impressions",0)::float8 AS impressions,
      COALESCE("clicks",0)::float8 AS clicks,
      COALESCE("cost_micros",0)::float8 AS cost_micros,
      COALESCE("conversions",0)::float8 AS conversions,
      COALESCE("conversion_value",0)::float8 AS conversion_value
    FROM "public"."ads_explorer_batch_models"
    WHERE "batch_id" = ${batchId}
  `);
  return rows.map((r) => ({
    shopifyProductId: r.shopify_product_id,
    sourceCampaignId: r.source_campaign_id,
    sourceCampaignName: r.source_campaign_name,
    brand: r.brand,
    lifecycleStatus: r.lifecycle_status,
    activeOfferCount: r.active_offer_count,
    impressions: r.impressions,
    clicks: r.clicks,
    costMicros: r.cost_micros,
    conversions: r.conversions,
    conversionValue: r.conversion_value,
  }));
}

export async function loadOffersForBatchModels(
  batchId: string
): Promise<
  Array<{
    shopifyProductId: string;
    offerId: string;
    languageCode: string;
    feedLabel: string;
    merchantId: string;
  }>
> {
  const rows = await prisma.$queryRaw<
    Array<{
      shopify_product_id: string;
      offer_id: string;
      language_code: string;
      feed_label: string;
      merchant_id: string;
    }>
  >(Prisma.sql`
    SELECT DISTINCT
      p."shopify_product_id"::text,
      p."offer_id",
      p."language_code",
      p."feed_label",
      p."merchant_id"::text
    FROM "public"."ads_explorer_batch_models" bm
    JOIN "public"."ads_shopping_product_current" p
      ON p."shopify_product_id" = bm."shopify_product_id"
    WHERE bm."batch_id" = ${batchId}
      AND p."is_current" = true
      AND p."merchant_id" = ${EXPLORER_DEFAULT_MERCHANT_ID}::bigint
      AND UPPER(p."feed_label") = ${EXPLORER_DEFAULT_FEED_LABEL}
      AND LOWER(p."language_code") IN (${Prisma.join(EXPLORER_ALLOWED_LANGUAGES)})
  `);
  return rows.map((r) => ({
    shopifyProductId: r.shopify_product_id,
    offerId: r.offer_id,
    languageCode: r.language_code,
    feedLabel: r.feed_label,
    merchantId: r.merchant_id,
  }));
}

export async function loadEligibleInStockOffersForBatchModels(
  batchId: string
): Promise<
  Array<{
    shopifyProductId: string;
    offerId: string;
    languageCode: string;
    feedLabel: string;
    merchantId: string;
  }>
> {
  const rows = await prisma.$queryRaw<
    Array<{
      shopify_product_id: string;
      offer_id: string;
      language_code: string;
      feed_label: string;
      merchant_id: string;
    }>
  >(Prisma.sql`
    SELECT DISTINCT
      p."shopify_product_id"::text,
      p."offer_id",
      p."language_code",
      p."feed_label",
      p."merchant_id"::text
    FROM "public"."ads_explorer_batch_models" bm
    JOIN "public"."ads_shopping_product_current" p
      ON p."shopify_product_id" = bm."shopify_product_id"
    WHERE bm."batch_id" = ${batchId}
      AND p."is_current" = true
      AND p."merchant_id" = ${EXPLORER_DEFAULT_MERCHANT_ID}::bigint
      AND UPPER(p."feed_label") = ${EXPLORER_DEFAULT_FEED_LABEL}
      AND LOWER(p."language_code") IN (${Prisma.join(EXPLORER_ALLOWED_LANGUAGES)})
      AND UPPER(p."channel") = 'ONLINE'
      AND UPPER(p."status") = 'ELIGIBLE'
      AND UPPER(p."availability") = 'IN_STOCK'
  `);
  return rows.map((r) => ({
    shopifyProductId: r.shopify_product_id,
    offerId: r.offer_id,
    languageCode: r.language_code,
    feedLabel: r.feed_label,
    merchantId: r.merchant_id,
  }));
}

export async function loadOfferAttrsForBatch(
  batchId: string
): Promise<
  Array<
    OfferAttrs & {
      shopifyProductId: string;
      campaignIdHint: string;
      campaignNameHint: string;
      status: string;
      availability: string;
      channel: string;
      languageCode: string;
      feedLabel: string;
    }
  >
> {
  const rows = await prisma.$queryRaw<
    Array<{
      shopify_product_id: string;
      source_campaign_id: string;
      source_campaign_name: string;
      offer_id: string;
      status: string;
      availability: string;
      channel: string;
      language_code: string;
      feed_label: string;
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
      bm."shopify_product_id"::text,
      bm."source_campaign_id",
      bm."source_campaign_name",
      p."offer_id",
      p."status",
      p."availability",
      p."channel",
      p."language_code",
      p."feed_label",
      COALESCE(p."brand",'') AS brand,
      COALESCE(p."product_type",'') AS product_type,
      COALESCE(p."custom_attr0",'') AS custom_attr0,
      COALESCE(p."custom_attr1",'') AS custom_attr1,
      COALESCE(p."custom_attr2",'') AS custom_attr2,
      COALESCE(p."custom_attr3",'') AS custom_attr3,
      COALESCE(p."custom_attr4",'') AS custom_attr4
    FROM "public"."ads_explorer_batch_models" bm
    JOIN "public"."ads_shopping_product_current" p
      ON p."shopify_product_id" = bm."shopify_product_id"
    WHERE bm."batch_id" = ${batchId}
      AND p."is_current" = true
      AND p."merchant_id" = ${EXPLORER_DEFAULT_MERCHANT_ID}::bigint
      AND UPPER(p."feed_label") = ${EXPLORER_DEFAULT_FEED_LABEL}
      AND LOWER(p."language_code") IN (${Prisma.join(EXPLORER_ALLOWED_LANGUAGES)})
      AND UPPER(p."channel") = 'ONLINE'
      AND UPPER(p."availability") = 'IN_STOCK'
  `);
  return rows.map((r) => ({
    shopifyProductId: r.shopify_product_id,
    campaignIdHint: r.source_campaign_id,
    campaignNameHint: r.source_campaign_name,
    offerId: r.offer_id,
    status: r.status,
    availability: r.availability,
    channel: r.channel,
    languageCode: r.language_code,
    feedLabel: r.feed_label,
    brand: r.brand,
    productType: r.product_type,
    customAttr0: r.custom_attr0,
    customAttr1: r.custom_attr1,
    customAttr2: r.custom_attr2,
    customAttr3: r.custom_attr3,
    customAttr4: r.custom_attr4,
  }));
}

export async function upsertOfferWrites(
  batchId: string,
  offers: Array<{
    shopifyProductId: string;
    offerId: string;
    languageCode: string;
    feedLabel: string;
    operation: "insert" | "delete";
  }>
): Promise<void> {
  for (const rows of chunk(offers, 500)) {
    const values = rows.map((row) => Prisma.sql`(
      ${randomUUID()},
      ${batchId},
      ${row.shopifyProductId}::bigint,
      ${row.offerId},
      ${row.languageCode},
      ${row.feedLabel},
      ${row.operation},
      'pending',
      0::int,
      null,
      null,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )`);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "public"."ads_explorer_offer_writes" (
        "id","batch_id","shopify_product_id","offer_id","content_language","feed_label",
        "operation","status","attempts","last_error","processed_at","created_at","updated_at"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("batch_id","offer_id","content_language","feed_label","operation")
      DO UPDATE SET
        "updated_at" = CURRENT_TIMESTAMP
    `);
  }
}

export async function updateBatchStatus(
  batchId: string,
  status: string,
  patch: { statsJson?: unknown; error?: string | null; activatedAt?: Date | null } = {}
): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "public"."ads_explorer_batches"
    SET
      "status" = ${status},
      "stats_json" = COALESCE(${patch.statsJson ? JSON.stringify(patch.statsJson) : null}::jsonb, "stats_json"),
      "error" = ${patch.error ?? null},
      "activated_at" = COALESCE(${patch.activatedAt ?? null}::timestamptz, "activated_at"),
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${batchId}
  `);
}

export async function revokeBatchAndHash(batchId: string, reason: string): Promise<void> {
  const revokedHash = `revoked:${createHash("sha256")
    .update(`${batchId}|${reason}|${Date.now()}`)
    .digest("hex")
    .slice(0, 16)}`;
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "public"."ads_explorer_batches"
    SET
      "status" = 'failed',
      "error" = ${reason},
      "plan_hash" = ${revokedHash},
      "stats_json" = COALESCE("stats_json", '{}'::jsonb) || jsonb_build_object(
        'revoked_at', CURRENT_TIMESTAMP,
        'revoked_reason', ${reason},
        'revoked_hash', ${revokedHash}
      ),
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${batchId}
  `);
}

export async function assertHashNotRevoked(confirmHash: string): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS n
    FROM "public"."ads_explorer_batches"
    WHERE "status" IN ('failed', 'rolled_back')
      AND "plan_hash" = ${confirmHash}
  `);
  if ((rows[0]?.n ?? 0) > 0) {
    throw new Error(`Confirm hash ${confirmHash} is revoked and cannot be reused`);
  }
}

export function recomputeBatchPlanHash(payload: unknown): string {
  return planHashFromPayload(payload);
}

export function expectedBatchEndFromNow(days = EXPLORER_DEFAULT_BATCH_DAYS): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function summarizeConcentration(values: number[]): {
  top1pct: number;
  top5pct: number;
  top10pct: number;
  giniApprox: number;
} {
  const arr = values.filter((v) => v > 0).sort((a, b) => b - a);
  const total = arr.reduce((s, v) => s + v, 0);
  if (arr.length === 0 || total <= 0) {
    return { top1pct: 0, top5pct: 0, top10pct: 0, giniApprox: 0 };
  }
  const share = (pct: number) => {
    const n = Math.max(1, Math.ceil((arr.length * pct) / 100));
    return Number(((arr.slice(0, n).reduce((s, v) => s + v, 0) / total) * 100).toFixed(2));
  };
  // Approx Gini from Lorenz curve discrete formula.
  const asc = arr.slice().sort((a, b) => a - b);
  let cum = 0;
  let area = 0;
  for (const v of asc) {
    const prev = cum / total;
    cum += v;
    const next = cum / total;
    area += (prev + next) / 2 / asc.length;
  }
  const gini = Number((1 - 2 * area).toFixed(4));
  return { top1pct: share(1), top5pct: share(5), top10pct: share(10), giniApprox: gini };
}

export async function saveListingBackups(
  batchId: string,
  nodes: ListingFilterNode[]
): Promise<{ rows: number; treeHash: string }> {
  const byCampaignAsset = new Map<string, ListingFilterNode[]>();
  for (const n of nodes) {
    const key = `${n.campaignId}|${n.assetGroupId}`;
    const list = byCampaignAsset.get(key) ?? [];
    list.push(n);
    byCampaignAsset.set(key, list);
  }
  let rows = 0;
  for (const [key, tree] of byCampaignAsset) {
    const [campaignId, assetGroupId] = key.split("|");
    const treeJson = JSON.stringify(tree);
    const treeHash = createHash("sha256").update(treeJson).digest("hex").slice(0, 16);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "public"."ads_explorer_listing_backups" (
        "id","batch_id","campaign_id","asset_group_id","captured_at","tree_json","tree_hash","created_at"
      )
      VALUES (
        ${randomUUID()},
        ${batchId},
        ${campaignId},
        ${assetGroupId},
        CURRENT_TIMESTAMP,
        ${treeJson}::jsonb,
        ${treeHash},
        CURRENT_TIMESTAMP
      )
    `);
    rows += 1;
  }
  const fullHash = createHash("sha256").update(JSON.stringify(nodes)).digest("hex").slice(0, 16);
  return { rows, treeHash: fullHash };
}

export function estimateListingMutationOps(
  nodes: ListingFilterNode[],
  effectiveRules = reconstructEffectiveRules(nodes)
): {
  includedLeafCount: number;
  estimatedOperations: number;
  campaignsTouched: number;
} {
  const includedLeafCount = nodes.filter((n) => n.type === "UNIT_INCLUDED").length;
  const estimatedOperations = includedLeafCount * LEAF_SUBDIVISION_OPS;
  const campaignsTouched = new Set(effectiveRules.map((r) => r.campaignId)).size;
  return { includedLeafCount, estimatedOperations, campaignsTouched };
}

export async function estimateOptimizedListingMutationOps(batchId: string): Promise<{
  includedLeafTotal: number;
  includedLeafTouched: number;
  operationsBefore: number;
  operationsAfter: number;
  campaignsTouched: number;
  assetGroupsTouched: number;
  touchedLeafIds: string[];
  touchedCampaignNames: string[];
  touchedAssetGroupIds: string[];
  touchedLeafPaths: string[];
  modelBrands: string[];
  sourceCampaignNames: string[];
  offerLeafResolutionIssues: Array<{ offerId: string; modelId: string; reason: string; campaignId: string }>;
  treeHashBefore: string;
  treeHashAfter: string;
  sampleProofNonExplorerIncluded: Array<{ offerId: string; campaignId: string; leafTouched: boolean; included: boolean }>;
}> {
  const { campaigns, listingNodes } = await loadExplorerCampaignsAndListingNodes();
  const offers = await loadOfferAttrsForBatch(batchId);
  const includedLeafTotal = listingNodes.filter((n) => n.type === "UNIT_INCLUDED").length;
  const operationsBefore = includedLeafTotal * LEAF_SUBDIVISION_OPS;
  const byCampaign = new Map<string, ListingFilterNode[]>();
  for (const n of listingNodes) {
    const list = byCampaign.get(n.campaignId) ?? [];
    list.push(n);
    byCampaign.set(n.campaignId, list);
  }

  const touchedLeafIds = new Set<string>();
  const touchedCampaigns = new Set<string>();
  const touchedAssets = new Set<string>();
  const issues: Array<{ offerId: string; modelId: string; reason: string; campaignId: string }> = [];
  const enabledCampaignIds = new Set(campaigns.map((c) => c.campaignId));

  for (const offer of offers) {
    const isEligible = offer.status.toUpperCase() === "ELIGIBLE" && offer.availability.toUpperCase() === "IN_STOCK";
    const campaignMatches: Array<{ campaignId: string; leafs: ListingFilterNode[] }> = [];
    for (const [campaignId, nodes] of byCampaign.entries()) {
      if (!enabledCampaignIds.has(campaignId)) continue;
      const resolved = resolveIncludedLeafNodesForOffer(offer, nodes);
      if (resolved.included && resolved.matchedIncludedLeafs.length > 0) {
        campaignMatches.push({ campaignId, leafs: resolved.matchedIncludedLeafs });
      }
    }
    if (isEligible && campaignMatches.length === 0) {
      issues.push({
        offerId: offer.offerId,
        modelId: offer.shopifyProductId,
        reason: "eligible_zero_included_leaf",
        campaignId: offer.campaignIdHint,
      });
      continue;
    }
    if (isEligible && campaignMatches.length > 1) {
      issues.push({
        offerId: offer.offerId,
        modelId: offer.shopifyProductId,
        reason: "eligible_multi_campaign_overlap",
        campaignId: offer.campaignIdHint,
      });
      continue;
    }
    for (const match of campaignMatches) {
      for (const leaf of match.leafs) {
        touchedLeafIds.add(leaf.id);
        touchedCampaigns.add(leaf.campaignId);
        touchedAssets.add(`${leaf.campaignId}|${leaf.assetGroupId}`);
      }
    }
  }

  const campaignNameById = new Map(campaigns.map((c) => [c.campaignId, c.campaignName]));
  const touchedCampaignNames = [...touchedCampaigns]
    .map((id) => campaignNameById.get(id) ?? id)
    .sort();
  const touchedAssetGroupIds = [...touchedAssets]
    .map((k) => k.split("|")[1] ?? k)
    .sort();
  const touchedLeafPaths: string[] = [];
  for (const leafId of touchedLeafIds) {
    const leaf = listingNodes.find((n) => n.id === leafId);
    if (!leaf) continue;
    const nodes = byCampaign.get(leaf.campaignId) ?? [];
    touchedLeafPaths.push(leafPath(nodes, leaf));
  }
  touchedLeafPaths.sort();
  const modelBrands = [...new Set(offers.map((o) => o.brand || "(empty)"))].sort();
  const sourceCampaignNames = [...new Set(offers.map((o) => o.campaignNameHint || "(unknown)"))].sort();

  const operationsAfter = touchedLeafIds.size * LEAF_SUBDIVISION_OPS;
  const treeHashBefore = createHash("sha256").update(JSON.stringify(listingNodes)).digest("hex").slice(0, 16);
  const treeHashAfter = createHash("sha256")
    .update(JSON.stringify({ treeHashBefore, touchedLeafIds: [...touchedLeafIds].sort(), operation: "exclude_explorer_active" }))
    .digest("hex")
    .slice(0, 16);

  const nonBatchSample = await prisma.$queryRaw<
    Array<{
      offer_id: string;
      campaign_id: string;
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
      bm."source_campaign_id" AS campaign_id,
      COALESCE(p."brand",'') AS brand,
      COALESCE(p."product_type",'') AS product_type,
      COALESCE(p."custom_attr0",'') AS custom_attr0,
      COALESCE(p."custom_attr1",'') AS custom_attr1,
      COALESCE(p."custom_attr2",'') AS custom_attr2,
      COALESCE(p."custom_attr3",'') AS custom_attr3,
      COALESCE(p."custom_attr4",'') AS custom_attr4
    FROM "public"."ads_shopping_product_current" p
    JOIN "public"."ads_explorer_batch_models" bm
      ON bm."source_campaign_id" = ANY(p."targeted_campaign_ids")
    WHERE p."is_current" = true
      AND p."merchant_id" = ${EXPLORER_DEFAULT_MERCHANT_ID}::bigint
      AND p."shopify_product_id" IS NOT NULL
      AND p."shopify_product_id" NOT IN (
        SELECT "shopify_product_id"
        FROM "public"."ads_explorer_batch_models"
        WHERE "batch_id" = ${batchId}
      )
    LIMIT 24
  `);

  const sampleProofNonExplorerIncluded = nonBatchSample.map((row) => {
    const nodes = byCampaign.get(row.campaign_id) ?? [];
    const resolved = resolveIncludedLeafNodesForOffer(
      {
        offerId: row.offer_id,
        brand: row.brand,
        productType: row.product_type,
        customAttr0: row.custom_attr0,
        customAttr1: row.custom_attr1,
        customAttr2: row.custom_attr2,
        customAttr3: row.custom_attr3,
        customAttr4: row.custom_attr4,
      },
      nodes
    );
    const match = offerMatchesListingRules(
      {
        offerId: row.offer_id,
        brand: row.brand,
        productType: row.product_type,
        customAttr0: row.custom_attr0,
        customAttr1: row.custom_attr1,
        customAttr2: row.custom_attr2,
        customAttr3: row.custom_attr3,
        customAttr4: row.custom_attr4,
      },
      nodes
    );
    const leafTouched = resolved.matchedIncludedLeafs.some((leaf) => touchedLeafIds.has(leaf.id));
    return {
      offerId: row.offer_id,
      campaignId: row.campaign_id,
      leafTouched,
      included: match.included,
    };
  });

  return {
    includedLeafTotal,
    includedLeafTouched: touchedLeafIds.size,
    operationsBefore,
    operationsAfter,
    campaignsTouched: touchedCampaigns.size,
    assetGroupsTouched: touchedAssets.size,
    touchedLeafIds: [...touchedLeafIds].sort(),
    touchedCampaignNames,
    touchedAssetGroupIds,
    touchedLeafPaths,
    modelBrands,
    sourceCampaignNames,
    offerLeafResolutionIssues: issues,
    treeHashBefore,
    treeHashAfter,
    sampleProofNonExplorerIncluded,
  };
}
