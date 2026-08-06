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
