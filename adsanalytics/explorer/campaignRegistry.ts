import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import type { Destination } from "@/adsanalytics/explorer/destinations";

export type CampaignRegistryRow = {
  role: Destination;
  campaignId: string;
  campaignName: string;
  campaignResourceName: string | null;
  adGroupId: string | null;
  adGroupResourceName: string | null;
  adGroupAdResourceName: string | null;
  budgetResourceName: string | null;
  includeLabel: string | null;
  statsJson: unknown;
};

export async function loadCampaignRegistry(): Promise<Map<Destination, CampaignRegistryRow>> {
  const rows = await prisma.$queryRaw<
    Array<{
      role: string;
      campaign_id: string;
      campaign_name: string;
      campaign_resource_name: string | null;
      ad_group_id: string | null;
      ad_group_resource_name: string | null;
      ad_group_ad_resource_name: string | null;
      budget_resource_name: string | null;
      include_label: string | null;
      stats_json: unknown;
    }>
  >(Prisma.sql`
    SELECT
      "role","campaign_id","campaign_name","campaign_resource_name",
      "ad_group_id","ad_group_resource_name","ad_group_ad_resource_name",
      "budget_resource_name","include_label","stats_json"
    FROM "public"."ads_explorer_campaigns"
  `);
  const map = new Map<Destination, CampaignRegistryRow>();
  for (const r of rows) {
    map.set(r.role as Destination, {
      role: r.role as Destination,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      campaignResourceName: r.campaign_resource_name,
      adGroupId: r.ad_group_id,
      adGroupResourceName: r.ad_group_resource_name,
      adGroupAdResourceName: r.ad_group_ad_resource_name,
      budgetResourceName: r.budget_resource_name,
      includeLabel: r.include_label,
      statsJson: r.stats_json,
    });
  }
  return map;
}

export async function upsertCampaignRegistry(
  row: Omit<CampaignRegistryRow, "statsJson"> & { statsJson?: unknown }
): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "public"."ads_explorer_campaigns" (
      "id","role","campaign_id","campaign_name","campaign_resource_name",
      "ad_group_id","ad_group_resource_name","ad_group_ad_resource_name",
      "budget_resource_name","include_label","stats_json","created_at","updated_at"
    )
    VALUES (
      gen_random_uuid()::text,
      ${row.role},
      ${row.campaignId},
      ${row.campaignName},
      ${row.campaignResourceName},
      ${row.adGroupId},
      ${row.adGroupResourceName},
      ${row.adGroupAdResourceName},
      ${row.budgetResourceName},
      ${row.includeLabel},
      ${JSON.stringify(row.statsJson ?? {})}::jsonb,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("role") DO UPDATE SET
      "campaign_id" = EXCLUDED."campaign_id",
      "campaign_name" = EXCLUDED."campaign_name",
      "campaign_resource_name" = COALESCE(EXCLUDED."campaign_resource_name", "ads_explorer_campaigns"."campaign_resource_name"),
      "ad_group_id" = COALESCE(EXCLUDED."ad_group_id", "ads_explorer_campaigns"."ad_group_id"),
      "ad_group_resource_name" = COALESCE(EXCLUDED."ad_group_resource_name", "ads_explorer_campaigns"."ad_group_resource_name"),
      "ad_group_ad_resource_name" = COALESCE(EXCLUDED."ad_group_ad_resource_name", "ads_explorer_campaigns"."ad_group_ad_resource_name"),
      "budget_resource_name" = COALESCE(EXCLUDED."budget_resource_name", "ads_explorer_campaigns"."budget_resource_name"),
      "include_label" = EXCLUDED."include_label",
      "stats_json" = COALESCE("ads_explorer_campaigns"."stats_json", '{}'::jsonb) || EXCLUDED."stats_json",
      "updated_at" = CURRENT_TIMESTAMP
  `);
}

export async function requireCampaign(
  registry: Map<Destination, CampaignRegistryRow>,
  role: Destination
): Promise<CampaignRegistryRow> {
  const row = registry.get(role);
  if (!row) {
    throw new Error(
      `Campaign role ${role} is not registered. Run the matching create/register command first.`
    );
  }
  return row;
}
