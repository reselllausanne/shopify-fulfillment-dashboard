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
