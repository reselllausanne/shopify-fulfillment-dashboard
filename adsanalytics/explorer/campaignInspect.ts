import type { AdsConfig } from "@/adsanalytics/config";
import { CUSTOM_LABEL_3_INDEX } from "@/adsanalytics/explorer/labels";
import { searchAll } from "@/adsanalytics/google/adsClient";

export type ProductGroupNode = {
  criterionId: string | null;
  adGroupId: string | null;
  type: string | null;
  negative: boolean;
  status: string | null;
  dimension: string | null;
  value: string | null;
  isEverythingElse: boolean;
};

export type CampaignFacts = {
  campaignId: string;
  campaignName: string;
  campaignResourceName: string;
  status: string | null;
  channelType: string | null;
  channelSubType: string | null;
  biddingStrategyType: string | null;
  startDateTime: string | null;
  endDateTime: string | null;
  merchantId: string | null;
  feedLabel: string | null;
  campaignPriority: number | null;
  budgetMicros: string | null;
  budgetResourceName: string | null;
  adGroupId: string | null;
  adGroupResourceName: string | null;
  adGroupName: string | null;
  adGroupStatus: string | null;
  maxCpcMicros: string | null;
  adGroupAdResourceName: string | null;
  productGroups: ProductGroupNode[];
  includedCustomLabel3: string[];
  excludedCustomLabel3: string[];
};

const CAMPAIGN_FIELDS = [
  "campaign.id",
  "campaign.name",
  "campaign.resource_name",
  "campaign.status",
  "campaign.advertising_channel_type",
  "campaign.advertising_channel_sub_type",
  "campaign.bidding_strategy_type",
  "campaign.start_date_time",
  "campaign.end_date_time",
  "campaign.shopping_setting.merchant_id",
  "campaign.shopping_setting.feed_label",
  "campaign.shopping_setting.campaign_priority",
  "campaign_budget.amount_micros",
  "campaign_budget.resource_name",
];

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function toStringOrNull(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

/**
 * Read-only snapshot of the Ads-side truth for a Shopping campaign: settings, ad group,
 * CPC and the full custom_label_3 product group tree. Both discovery and registration
 * compare against this so no command trusts the local registry alone.
 */
export async function fetchCampaignFacts(
  config: AdsConfig,
  campaignIds: string[]
): Promise<Map<string, CampaignFacts>> {
  const facts = new Map<string, CampaignFacts>();
  if (campaignIds.length === 0) return facts;
  const idList = campaignIds.map((id) => id.trim()).filter(Boolean);
  if (idList.length === 0) return facts;
  const inClause = `(${idList.join(", ")})`;

  const { rows: campaignRows } = await searchAll(
    config,
    ["SELECT", `  ${CAMPAIGN_FIELDS.join(",\n  ")}`, "FROM campaign", `WHERE campaign.id IN ${inClause}`].join(
      "\n"
    )
  );
  for (const row of campaignRows) {
    const campaign = asRecord(row.campaign);
    const budget = asRecord(row.campaignBudget);
    const shopping = asRecord(campaign.shoppingSetting);
    const id = String(campaign.id ?? "");
    if (!id) continue;
    facts.set(id, {
      campaignId: id,
      campaignName: String(campaign.name ?? ""),
      campaignResourceName: String(
        campaign.resourceName ?? `customers/${config.customerId}/campaigns/${id}`
      ),
      status: toStringOrNull(campaign.status),
      channelType: toStringOrNull(campaign.advertisingChannelType),
      channelSubType: toStringOrNull(campaign.advertisingChannelSubType),
      biddingStrategyType: toStringOrNull(campaign.biddingStrategyType),
      startDateTime: toStringOrNull(campaign.startDateTime),
      endDateTime: toStringOrNull(campaign.endDateTime),
      merchantId: toStringOrNull(shopping.merchantId),
      feedLabel: toStringOrNull(shopping.feedLabel),
      campaignPriority:
        shopping.campaignPriority === undefined || shopping.campaignPriority === null
          ? null
          : Number(shopping.campaignPriority),
      budgetMicros: toStringOrNull(budget.amountMicros),
      budgetResourceName: toStringOrNull(budget.resourceName),
      adGroupId: null,
      adGroupResourceName: null,
      adGroupName: null,
      adGroupStatus: null,
      maxCpcMicros: null,
      adGroupAdResourceName: null,
      productGroups: [],
      includedCustomLabel3: [],
      excludedCustomLabel3: [],
    });
  }
  if (facts.size === 0) return facts;

  const { rows: adGroupRows } = await searchAll(
    config,
    [
      "SELECT campaign.id, ad_group.id, ad_group.resource_name, ad_group.name, ad_group.status, ad_group.cpc_bid_micros",
      "FROM ad_group",
      `WHERE campaign.id IN ${inClause} AND ad_group.status != 'REMOVED'`,
    ].join("\n")
  );
  for (const row of adGroupRows) {
    const campaignId = String(asRecord(row.campaign).id ?? "");
    const entry = facts.get(campaignId);
    if (!entry || entry.adGroupId) continue;
    const adGroup = asRecord(row.adGroup);
    entry.adGroupId = toStringOrNull(adGroup.id);
    entry.adGroupResourceName = toStringOrNull(adGroup.resourceName);
    entry.adGroupName = toStringOrNull(adGroup.name);
    entry.adGroupStatus = toStringOrNull(adGroup.status);
    entry.maxCpcMicros = toStringOrNull(adGroup.cpcBidMicros);
  }

  const { rows: adRows } = await searchAll(
    config,
    [
      "SELECT campaign.id, ad_group_ad.resource_name, ad_group_ad.status",
      "FROM ad_group_ad",
      `WHERE campaign.id IN ${inClause} AND ad_group_ad.status != 'REMOVED'`,
    ].join("\n")
  );
  for (const row of adRows) {
    const campaignId = String(asRecord(row.campaign).id ?? "");
    const entry = facts.get(campaignId);
    if (!entry || entry.adGroupAdResourceName) continue;
    entry.adGroupAdResourceName = toStringOrNull(asRecord(row.adGroupAd).resourceName);
  }

  const { rows: criterionRows } = await searchAll(
    config,
    [
      "SELECT",
      "  campaign.id,",
      "  ad_group.id,",
      "  ad_group_criterion.criterion_id,",
      "  ad_group_criterion.status,",
      "  ad_group_criterion.negative,",
      "  ad_group_criterion.listing_group.type,",
      "  ad_group_criterion.listing_group.case_value.product_custom_attribute.index,",
      "  ad_group_criterion.listing_group.case_value.product_custom_attribute.value,",
      "  ad_group_criterion.listing_group.case_value.product_brand.value,",
      "  ad_group_criterion.listing_group.case_value.product_type.value",
      "FROM ad_group_criterion",
      `WHERE campaign.id IN ${inClause}`,
      "  AND ad_group_criterion.type = 'LISTING_GROUP'",
      "  AND ad_group_criterion.status != 'REMOVED'",
    ].join("\n")
  );
  for (const row of criterionRows) {
    const campaignId = String(asRecord(row.campaign).id ?? "");
    const entry = facts.get(campaignId);
    if (!entry) continue;
    const criterion = asRecord(row.adGroupCriterion);
    const listingGroup = asRecord(criterion.listingGroup);
    const caseValue = asRecord(listingGroup.caseValue);
    const customAttribute = asRecord(caseValue.productCustomAttribute);
    const brand = asRecord(caseValue.productBrand);
    const productType = asRecord(caseValue.productType);

    let dimension: string | null = null;
    let value: string | null = null;
    if (Object.keys(customAttribute).length > 0) {
      dimension = `custom_label_${String(customAttribute.index ?? "").replace("INDEX", "")}`;
      value = toStringOrNull(customAttribute.value);
    } else if (Object.keys(brand).length > 0) {
      dimension = "brand";
      value = toStringOrNull(brand.value);
    } else if (Object.keys(productType).length > 0) {
      dimension = "product_type";
      value = toStringOrNull(productType.value);
    }

    const negative = criterion.negative === true;
    const node: ProductGroupNode = {
      criterionId: toStringOrNull(criterion.criterionId),
      adGroupId: toStringOrNull(asRecord(row.adGroup).id),
      type: toStringOrNull(listingGroup.type),
      negative,
      status: toStringOrNull(criterion.status),
      dimension,
      value,
      isEverythingElse: dimension !== null && value === null,
    };
    entry.productGroups.push(node);

    const isLabel3 =
      Object.keys(customAttribute).length > 0 && customAttribute.index === CUSTOM_LABEL_3_INDEX;
    if (isLabel3 && node.value) {
      if (negative) entry.excludedCustomLabel3.push(node.value);
      else entry.includedCustomLabel3.push(node.value);
    }
  }

  return facts;
}

/**
 * Every non-removed Shopping campaign in the account, so an operator can find a campaign
 * that already exists in the UI but was never mapped to a routing role locally.
 */
export async function listShoppingCampaignIds(config: AdsConfig): Promise<string[]> {
  const { rows } = await searchAll(
    config,
    [
      "SELECT campaign.id",
      "FROM campaign",
      "WHERE campaign.advertising_channel_type = 'SHOPPING' AND campaign.status != 'REMOVED'",
    ].join("\n")
  );
  return rows
    .map((row) => toStringOrNull(asRecord(row.campaign).id))
    .filter((id): id is string => Boolean(id));
}
