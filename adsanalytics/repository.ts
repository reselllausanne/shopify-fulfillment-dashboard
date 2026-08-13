import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import type { AggregatedProductRow, CampaignDailyRow } from "@/adsanalytics/transform";

/**
 * Idempotent bulk upserts. Chunked well below the 65 535 bound-parameter limit
 * of the Postgres wire protocol.
 */
const CAMPAIGN_CHUNK = 500;
const PRODUCT_CHUNK = 300;
const INVENTORY_CHUNK = 300;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function upsertCampaignDaily(rows: CampaignDailyRow[]): Promise<number> {
  let written = 0;

  for (const batch of chunk(rows, CAMPAIGN_CHUNK)) {
    const values = batch.map(
      (row) => Prisma.sql`(
        ${randomUUID()},
        ${row.date}::date,
        ${row.campaignId.toString()}::bigint,
        ${row.campaignName},
        ${row.campaignStatus},
        ${row.channelType},
        ${row.impressions.toString()}::bigint,
        ${row.clicks.toString()}::bigint,
        ${row.costMicros.toString()}::bigint,
        ${row.conversions.toString()}::numeric,
        ${row.conversionValue.toString()}::numeric
      )`
    );

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "public"."ads_campaign_daily" (
        "id", "date", "campaign_id", "campaign_name", "campaign_status", "channel_type",
        "impressions", "clicks", "cost_micros", "conversions", "conversion_value"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("date", "campaign_id") DO UPDATE SET
        "campaign_name" = EXCLUDED."campaign_name",
        "campaign_status" = EXCLUDED."campaign_status",
        "channel_type" = EXCLUDED."channel_type",
        "impressions" = EXCLUDED."impressions",
        "clicks" = EXCLUDED."clicks",
        "cost_micros" = EXCLUDED."cost_micros",
        "conversions" = EXCLUDED."conversions",
        "conversion_value" = EXCLUDED."conversion_value",
        "updated_at" = CURRENT_TIMESTAMP
    `);

    written += batch.length;
  }

  return written;
}

export async function upsertProductDaily(rows: AggregatedProductRow[]): Promise<number> {
  let written = 0;

  for (const batch of chunk(rows, PRODUCT_CHUNK)) {
    const values = batch.map(
      (row) => Prisma.sql`(
        ${randomUUID()},
        ${row.date}::date,
        ${row.campaignId.toString()}::bigint,
        ${row.merchantId.toString()}::bigint,
        ${row.feedLabel},
        ${row.languageCode},
        ${row.offerId},
        ${row.campaignName},
        ${row.title},
        ${row.brand},
        ${row.productType},
        ${row.customAttr0},
        ${row.customAttr1},
        ${row.customAttr2},
        ${row.customAttr3},
        ${row.customAttr4},
        ${row.impressions.toString()}::bigint,
        ${row.clicks.toString()}::bigint,
        ${row.costMicros.toString()}::bigint,
        ${row.conversions.toString()}::numeric,
        ${row.conversionValue.toString()}::numeric,
        ${row.shopifyProductId ? row.shopifyProductId.toString() : null}::bigint,
        ${row.shopifyVariantId ? row.shopifyVariantId.toString() : null}::bigint,
        ${row.attributeConflict},
        ${row.sourceRows}
      )`
    );

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "public"."ads_product_daily" (
        "id", "date", "campaign_id", "merchant_id", "feed_label", "language_code", "offer_id",
        "campaign_name", "title", "brand", "product_type",
        "custom_attr0", "custom_attr1", "custom_attr2", "custom_attr3", "custom_attr4",
        "impressions", "clicks", "cost_micros", "conversions", "conversion_value",
        "shopify_product_id", "shopify_variant_id", "attribute_conflict", "source_rows"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("date", "campaign_id", "merchant_id", "feed_label", "language_code", "offer_id")
      DO UPDATE SET
        "campaign_name" = EXCLUDED."campaign_name",
        "title" = EXCLUDED."title",
        "brand" = EXCLUDED."brand",
        "product_type" = EXCLUDED."product_type",
        "custom_attr0" = EXCLUDED."custom_attr0",
        "custom_attr1" = EXCLUDED."custom_attr1",
        "custom_attr2" = EXCLUDED."custom_attr2",
        "custom_attr3" = EXCLUDED."custom_attr3",
        "custom_attr4" = EXCLUDED."custom_attr4",
        "impressions" = EXCLUDED."impressions",
        "clicks" = EXCLUDED."clicks",
        "cost_micros" = EXCLUDED."cost_micros",
        "conversions" = EXCLUDED."conversions",
        "conversion_value" = EXCLUDED."conversion_value",
        "shopify_product_id" = EXCLUDED."shopify_product_id",
        "shopify_variant_id" = EXCLUDED."shopify_variant_id",
        "attribute_conflict" = EXCLUDED."attribute_conflict",
        "source_rows" = EXCLUDED."source_rows",
        "updated_at" = CURRENT_TIMESTAMP
    `);

    written += batch.length;
  }

  return written;
}

export type ShoppingProductSnapshotRow = {
  merchantId: bigint;
  channel: string;
  languageCode: string;
  feedLabel: string;
  offerId: string;
  title: string;
  brand: string;
  productType: string;
  customAttr0: string;
  customAttr1: string;
  customAttr2: string;
  customAttr3: string;
  customAttr4: string;
  status: string;
  availability: string;
  shopifyProductId: bigint | null;
  shopifyVariantId: bigint | null;
  targetedCampaignIds: string[];
  targetedCampaignNames: string[];
};

export async function upsertShoppingProductCurrent(
  rows: ShoppingProductSnapshotRow[],
  runId: string,
  seenAt: Date
): Promise<number> {
  let written = 0;
  for (const batch of chunk(rows, INVENTORY_CHUNK)) {
    const values = batch.map(
      (row) => Prisma.sql`(
        ${randomUUID()},
        ${row.merchantId.toString()}::bigint,
        ${row.channel},
        ${row.languageCode},
        ${row.feedLabel},
        ${row.offerId},
        ${row.title},
        ${row.brand},
        ${row.productType},
        ${row.customAttr0},
        ${row.customAttr1},
        ${row.customAttr2},
        ${row.customAttr3},
        ${row.customAttr4},
        ${row.status},
        ${row.availability},
        ${row.shopifyProductId ? row.shopifyProductId.toString() : null}::bigint,
        ${row.shopifyVariantId ? row.shopifyVariantId.toString() : null}::bigint,
        ${row.targetedCampaignIds}::text[],
        ${row.targetedCampaignNames}::text[],
        ${runId},
        ${seenAt}::timestamptz,
        true
      )`
    );

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "public"."ads_shopping_product_current" (
        "id", "merchant_id", "channel", "language_code", "feed_label", "offer_id",
        "title", "brand", "product_type",
        "custom_attr0", "custom_attr1", "custom_attr2", "custom_attr3", "custom_attr4",
        "status", "availability", "shopify_product_id", "shopify_variant_id",
        "targeted_campaign_ids", "targeted_campaign_names",
        "last_seen_run_id", "last_seen_at", "is_current"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("merchant_id", "channel", "language_code", "feed_label", "offer_id")
      DO UPDATE SET
        "title" = EXCLUDED."title",
        "brand" = EXCLUDED."brand",
        "product_type" = EXCLUDED."product_type",
        "custom_attr0" = EXCLUDED."custom_attr0",
        "custom_attr1" = EXCLUDED."custom_attr1",
        "custom_attr2" = EXCLUDED."custom_attr2",
        "custom_attr3" = EXCLUDED."custom_attr3",
        "custom_attr4" = EXCLUDED."custom_attr4",
        "status" = EXCLUDED."status",
        "availability" = EXCLUDED."availability",
        "shopify_product_id" = EXCLUDED."shopify_product_id",
        "shopify_variant_id" = EXCLUDED."shopify_variant_id",
        "targeted_campaign_ids" = EXCLUDED."targeted_campaign_ids",
        "targeted_campaign_names" = EXCLUDED."targeted_campaign_names",
        "last_seen_run_id" = EXCLUDED."last_seen_run_id",
        "last_seen_at" = EXCLUDED."last_seen_at",
        "is_current" = true,
        "updated_at" = CURRENT_TIMESTAMP
    `);
    written += batch.length;
  }
  return written;
}

/**
 * Atomic snapshot finalize:
 * keep rows touched by current successful run as current,
 * mark previously-current untouched rows as not current.
 */
export async function finalizeShoppingProductCurrent(runId: string): Promise<{ deactivated: number }> {
  const deactivated = await prisma.$executeRaw(Prisma.sql`
    UPDATE "public"."ads_shopping_product_current"
    SET "is_current" = false, "updated_at" = CURRENT_TIMESTAMP
    WHERE "is_current" = true
      AND "last_seen_run_id" <> ${runId}
  `);
  return { deactivated };
}

export type CampaignSettingsSnapshotRow = {
  snapshotDate: string;
  campaignId: bigint;
  campaignName: string;
  status: string;
  channelType: string;
  budgetMicros: bigint | null;
  biddingStrategy: string | null;
  targetRoas: number | null;
  merchantId: bigint | null;
  feedLabel: string | null;
  listingGroupFilters: Prisma.JsonValue | null;
};

export async function upsertCampaignSettingsDaily(rows: CampaignSettingsSnapshotRow[]): Promise<number> {
  let written = 0;
  for (const batch of chunk(rows, CAMPAIGN_CHUNK)) {
    const values = batch.map(
      (row) => Prisma.sql`(
        ${randomUUID()},
        ${row.snapshotDate}::date,
        ${row.campaignId.toString()}::bigint,
        ${row.campaignName},
        ${row.status},
        ${row.channelType},
        ${row.budgetMicros ? row.budgetMicros.toString() : null}::bigint,
        ${row.biddingStrategy},
        ${row.targetRoas}::numeric,
        ${row.merchantId ? row.merchantId.toString() : null}::bigint,
        ${row.feedLabel},
        ${row.listingGroupFilters ? JSON.stringify(row.listingGroupFilters) : null}::jsonb
      )`
    );
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "public"."ads_campaign_settings_daily" (
        "id", "snapshot_date", "campaign_id", "campaign_name", "status", "channel_type",
        "budget_micros", "bidding_strategy", "target_roas", "merchant_id", "feed_label", "listing_group_filters"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("snapshot_date", "campaign_id")
      DO UPDATE SET
        "campaign_name" = EXCLUDED."campaign_name",
        "status" = EXCLUDED."status",
        "channel_type" = EXCLUDED."channel_type",
        "budget_micros" = EXCLUDED."budget_micros",
        "bidding_strategy" = EXCLUDED."bidding_strategy",
        "target_roas" = EXCLUDED."target_roas",
        "merchant_id" = EXCLUDED."merchant_id",
        "feed_label" = EXCLUDED."feed_label",
        "listing_group_filters" = EXCLUDED."listing_group_filters"
    `);
    written += batch.length;
  }
  return written;
}

export type InventoryFunnelDailyRow = {
  date: string;
  granularity: string;
  windowDays: number;
  periodStart: string;
  periodEnd: string;
  total: number;
  targeted: number;
  notTargeted: number;
  withImpressions7d: number;
  withImpressions30d: number;
  withClicks7d: number;
  withClicks30d: number;
  withSpend30d: number;
  withConversions30d: number;
  spendZeroConversion30d: number;
  unmapped: number;
  statsJson: Prisma.JsonValue | null;
};

export async function upsertInventoryFunnelDaily(rows: InventoryFunnelDailyRow[]): Promise<number> {
  let written = 0;
  for (const batch of chunk(rows, CAMPAIGN_CHUNK)) {
    const values = batch.map(
      (row) => Prisma.sql`(
        ${randomUUID()},
        ${row.date}::date,
        ${row.granularity},
        ${row.windowDays}::int,
        ${row.periodStart}::date,
        ${row.periodEnd}::date,
        ${row.total}::int,
        ${row.targeted}::int,
        ${row.notTargeted}::int,
        ${row.withImpressions7d}::int,
        ${row.withImpressions30d}::int,
        ${row.withClicks7d}::int,
        ${row.withClicks30d}::int,
        ${row.withSpend30d}::int,
        ${row.withConversions30d}::int,
        ${row.spendZeroConversion30d}::numeric,
        ${row.unmapped}::int,
        ${row.statsJson ? JSON.stringify(row.statsJson) : null}::jsonb
      )`
    );
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "public"."ads_inventory_funnel_daily" (
        "id", "date", "granularity", "window_days", "period_start", "period_end",
        "total", "targeted", "not_targeted",
        "with_impressions_7d", "with_impressions_30d",
        "with_clicks_7d", "with_clicks_30d",
        "with_spend_30d", "with_conversions_30d", "spend_zero_conversion_30d",
        "unmapped", "stats_json"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("date", "granularity", "window_days")
      DO UPDATE SET
        "period_start" = EXCLUDED."period_start",
        "period_end" = EXCLUDED."period_end",
        "total" = EXCLUDED."total",
        "targeted" = EXCLUDED."targeted",
        "not_targeted" = EXCLUDED."not_targeted",
        "with_impressions_7d" = EXCLUDED."with_impressions_7d",
        "with_impressions_30d" = EXCLUDED."with_impressions_30d",
        "with_clicks_7d" = EXCLUDED."with_clicks_7d",
        "with_clicks_30d" = EXCLUDED."with_clicks_30d",
        "with_spend_30d" = EXCLUDED."with_spend_30d",
        "with_conversions_30d" = EXCLUDED."with_conversions_30d",
        "spend_zero_conversion_30d" = EXCLUDED."spend_zero_conversion_30d",
        "unmapped" = EXCLUDED."unmapped",
        "stats_json" = EXCLUDED."stats_json"
    `);
    written += batch.length;
  }
  return written;
}
