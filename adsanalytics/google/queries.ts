/** GAQL used by the phase 1 POC. Read-only SELECTs, no mutations anywhere. */

export const CAMPAIGN_FIELDS = [
  "segments.date",
  "campaign.id",
  "campaign.name",
  "campaign.status",
  "campaign.advertising_channel_type",
  "metrics.impressions",
  "metrics.clicks",
  "metrics.cost_micros",
  "metrics.conversions",
  "metrics.conversions_value",
] as const;

export const PRODUCT_FIELDS = [
  "segments.date",
  "campaign.id",
  "campaign.name",
  "segments.product_merchant_id",
  "segments.product_feed_label",
  "segments.product_language",
  "segments.product_item_id",
  "segments.product_title",
  "segments.product_brand",
  "segments.product_type_l1",
  "segments.product_type_l2",
  "segments.product_type_l3",
  "segments.product_custom_attribute0",
  "segments.product_custom_attribute1",
  "segments.product_custom_attribute2",
  "segments.product_custom_attribute3",
  "segments.product_custom_attribute4",
  "metrics.impressions",
  "metrics.clicks",
  "metrics.cost_micros",
  "metrics.conversions",
  "metrics.conversions_value",
] as const;

export function campaignDailyQuery(startDate: string, endDate: string): string {
  return [
    `SELECT ${CAMPAIGN_FIELDS.join(", ")}`,
    "FROM campaign",
    `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
    "ORDER BY segments.date ASC",
  ].join(" ");
}

export function productDailyQuery(startDate: string, endDate: string): string {
  return [
    `SELECT ${PRODUCT_FIELDS.join(", ")}`,
    "FROM shopping_performance_view",
    `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
    "ORDER BY segments.date ASC",
  ].join(" ");
}

/** Smallest possible query: proves the credentials reach the account. */
export function accountProbeQuery(): string {
  return [
    "SELECT customer.id, customer.descriptive_name, customer.currency_code,",
    "customer.time_zone, customer.manager, customer.test_account",
    "FROM customer",
    "LIMIT 1",
  ].join(" ");
}

/**
 * PMax channel mix (Shopping vs Display/Video/etc.) via product-data / network / video segments.
 * Read-only. Filter to PERFORMANCE_MAX; optional name substring filter applied by caller.
 */
export function pmaxChannelPerformanceQuery(startDate: string, endDate: string): string {
  return [
    "SELECT",
    "  campaign.id,",
    "  campaign.name,",
    "  segments.ad_using_product_data,",
    "  segments.ad_network_type,",
    "  segments.ad_using_video,",
    "  metrics.cost_micros,",
    "  metrics.conversions,",
    "  metrics.conversions_value",
    "FROM campaign",
    "WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'",
    `  AND segments.date BETWEEN '${startDate}' AND '${endDate}'`,
  ].join("\n");
}

/** Read-only PMax campaign settings (no mutate). v25: no url_expansion_opt_out. */
export function pmaxCampaignSettingsQuery(): string {
  return [
    "SELECT",
    "  campaign.id,",
    "  campaign.name,",
    "  campaign.status,",
    "  campaign.advertising_channel_type,",
    "  campaign.asset_automation_settings,",
    "  campaign.bidding_strategy_type,",
    "  campaign.maximize_conversion_value.target_roas,",
    "  campaign.shopping_setting.merchant_id,",
    "  campaign.shopping_setting.feed_label,",
    "  campaign.shopping_setting.campaign_priority,",
    "  campaign.shopping_setting.enable_local,",
    "  campaign.shopping_setting.disable_product_feed,",
    "  campaign_budget.amount_micros,",
    "  campaign_budget.delivery_method,",
    "  campaign_budget.period",
    "FROM campaign",
    "WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'",
  ].join("\n");
}

/** Asset groups attached to PMax campaigns. */
export function pmaxAssetGroupQuery(): string {
  return [
    "SELECT",
    "  campaign.id,",
    "  campaign.name,",
    "  asset_group.id,",
    "  asset_group.name,",
    "  asset_group.status,",
    "  asset_group.final_urls,",
    "  asset_group.path1,",
    "  asset_group.path2",
    "FROM asset_group",
    "WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'",
  ].join("\n");
}

/** Assets linked into PMax asset groups. */
export function pmaxAssetGroupAssetQuery(): string {
  return [
    "SELECT",
    "  campaign.id,",
    "  campaign.name,",
    "  asset_group.id,",
    "  asset_group.name,",
    "  asset_group_asset.field_type,",
    "  asset_group_asset.status,",
    "  asset.id,",
    "  asset.type,",
    "  asset.name,",
    "  asset.text_asset.text,",
    "  asset.image_asset.full_size.url,",
    "  asset.youtube_video_asset.youtube_video_id",
    "FROM asset_group_asset",
    "WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'",
  ].join("\n");
}

/** Listing-group / product feed signals on asset groups (feed types). */
export function pmaxAssetGroupListingGroupQuery(): string {
  return [
    "SELECT",
    "  campaign.id,",
    "  campaign.name,",
    "  asset_group.id,",
    "  asset_group.name,",
    "  asset_group_listing_group_filter.id,",
    "  asset_group_listing_group_filter.type,",
    "  asset_group_listing_group_filter.listing_source",
    "FROM asset_group_listing_group_filter",
    "WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'",
  ].join("\n");
}

/**
 * Full PMax listing-group filter tree (parent + case_value dimensions).
 * Used by overlap:verify to reconstruct effective inclusions/exclusions.
 */
export function pmaxListingGroupFilterTreeQuery(): string {
  return [
    "SELECT",
    "  campaign.id,",
    "  campaign.name,",
    "  campaign.status,",
    "  asset_group.id,",
    "  asset_group.name,",
    "  asset_group.status,",
    "  asset_group_listing_group_filter.resource_name,",
    "  asset_group_listing_group_filter.id,",
    "  asset_group_listing_group_filter.parent_listing_group_filter,",
    "  asset_group_listing_group_filter.type,",
    "  asset_group_listing_group_filter.listing_source,",
    "  asset_group_listing_group_filter.case_value.product_brand.value,",
    "  asset_group_listing_group_filter.case_value.product_item_id.value,",
    "  asset_group_listing_group_filter.case_value.product_type.level,",
    "  asset_group_listing_group_filter.case_value.product_type.value,",
    "  asset_group_listing_group_filter.case_value.product_custom_attribute.index,",
    "  asset_group_listing_group_filter.case_value.product_custom_attribute.value,",
    "  asset_group_listing_group_filter.case_value.product_condition.condition,",
    "  asset_group_listing_group_filter.case_value.product_channel.channel,",
    "  asset_group_listing_group_filter.case_value.product_category.category_id,",
    "  asset_group_listing_group_filter.case_value.product_category.level",
    "FROM asset_group_listing_group_filter",
    "WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'",
  ].join("\n");
}

/** Device split for CVR diagnosis (campaign-level metrics). */
export function campaignDevicePerformanceQuery(startDate: string, endDate: string): string {
  return [
    "SELECT",
    "  campaign.id,",
    "  campaign.name,",
    "  campaign.advertising_channel_type,",
    "  segments.device,",
    "  metrics.impressions,",
    "  metrics.clicks,",
    "  metrics.cost_micros,",
    "  metrics.conversions,",
    "  metrics.conversions_value",
    "FROM campaign",
    "WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'",
    `  AND segments.date BETWEEN '${startDate}' AND '${endDate}'`,
  ].join("\n");
}

/** Conversion-action mix (to verify Purchase-only conversions). */
export function campaignConversionActionQuery(startDate: string, endDate: string): string {
  return [
    "SELECT",
    "  campaign.id,",
    "  campaign.name,",
    "  segments.conversion_action,",
    "  segments.conversion_action_name,",
    "  segments.conversion_action_category,",
    "  metrics.conversions,",
    "  metrics.conversions_value,",
    "  metrics.all_conversions,",
    "  metrics.all_conversions_value",
    "FROM campaign",
    "WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'",
    `  AND segments.date BETWEEN '${startDate}' AND '${endDate}'`,
  ].join("\n");
}

/** Conversion action catalogue (type/category/primary). */
export function conversionActionCatalogQuery(): string {
  return [
    "SELECT",
    "  conversion_action.id,",
    "  conversion_action.name,",
    "  conversion_action.type,",
    "  conversion_action.category,",
    "  conversion_action.status,",
    "  conversion_action.primary_for_goal,",
    "  conversion_action.counting_type,",
    "  conversion_action.include_in_conversions_metric",
    "FROM conversion_action",
  ].join("\n");
}

/** PMax product-data vs non-product-data with clicks for CVR. */
export function pmaxProductDataCvrQuery(startDate: string, endDate: string): string {
  return [
    "SELECT",
    "  campaign.id,",
    "  campaign.name,",
    "  segments.ad_using_product_data,",
    "  segments.ad_network_type,",
    "  metrics.impressions,",
    "  metrics.clicks,",
    "  metrics.cost_micros,",
    "  metrics.conversions,",
    "  metrics.conversions_value",
    "FROM campaign",
    "WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'",
    `  AND segments.date BETWEEN '${startDate}' AND '${endDate}'`,
  ].join("\n");
}

export const SHOPPING_PRODUCT_CURRENT_FIELDS = [
  "shopping_product.merchant_center_id",
  "shopping_product.channel",
  "shopping_product.language_code",
  "shopping_product.feed_label",
  "shopping_product.item_id",
  "shopping_product.title",
  "shopping_product.brand",
  "shopping_product.product_type_level1",
  "shopping_product.product_type_level2",
  "shopping_product.product_type_level3",
  "shopping_product.custom_attribute0",
  "shopping_product.custom_attribute1",
  "shopping_product.custom_attribute2",
  "shopping_product.custom_attribute3",
  "shopping_product.custom_attribute4",
  "shopping_product.status",
  "shopping_product.availability",
] as const;

/** shopping_product account scope: all currently existing linked Merchant products. */
export function shoppingProductAccountScopeQuery(): string {
  return [
    `SELECT ${SHOPPING_PRODUCT_CURRENT_FIELDS.join(", ")}`,
    "FROM shopping_product",
  ].join(" ");
}

/**
 * shopping_product campaign scope for one active Shopping/PMax campaign.
 * Equality filter on campaign.id is required by Google.
 */
export function shoppingProductCampaignScopeQuery(customerId: string, campaignId: string): string {
  const campaignResource = `customers/${customerId}/campaigns/${campaignId}`;
  // shopping_product.campaign is a context filter, not a targeting filter: it returns the
  // whole Merchant catalog evaluated against that campaign. Only rows whose per-campaign
  // status is not NOT_ELIGIBLE are actually targeted by the campaign's listing tree.
  return [
    "SELECT shopping_product.campaign, shopping_product.item_id,",
    "shopping_product.merchant_center_id, shopping_product.channel,",
    "shopping_product.language_code, shopping_product.feed_label,",
    "shopping_product.status",
    "FROM shopping_product",
    `WHERE shopping_product.campaign = '${campaignResource}'`,
    "AND shopping_product.status != 'NOT_ELIGIBLE'",
  ].join(" ");
}

/** Active Shopping/PMax campaigns used to build campaign-scope union. */
export function activeShoppingAndPmaxCampaignsQuery(): string {
  return [
    "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type",
    "FROM campaign",
    "WHERE campaign.advertising_channel_type IN ('SHOPPING','PERFORMANCE_MAX')",
    "AND campaign.status = 'ENABLED'",
  ].join(" ");
}
