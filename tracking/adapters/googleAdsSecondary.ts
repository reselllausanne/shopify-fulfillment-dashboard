/**
 * Google Ads SECONDARY test conversion (click upload) — DISABLED adapter (gates G4 / G5).
 *
 * Only ever targets a NEW conversion action created for the experiment, verified Secondary
 * (primary_for_goal = false, not in the "Conversions" column used by bidding). Never one of the
 * existing Simprosys / GA4-imported actions. Builds the ClickConversion body only.
 */
import { assertDestinationOpen, isProductionId } from "../guards";
import type { ShadowPurchase } from "../contract";

export type ConversionActionCheck = {
  id: string;
  name: string;
  status: string;
  type: string;
  primaryForGoal: boolean;
  /** Ads "Include in 'Conversions'" (= counts for bidding when the goal is in use). */
  includeInConversionsMetric?: boolean;
};

/** Pre-flight on a conversion_action row (GAQL) before any upload. */
export function validateSecondaryAction(row: ConversionActionCheck): string[] {
  const problems: string[] = [];
  if (isProductionId(row.id)) problems.push("existing production conversion action");
  if (row.primaryForGoal) problems.push("action is Primary — would affect bidding");
  if (row.includeInConversionsMetric) problems.push("action included in Conversions metric");
  if (row.type !== "UPLOAD_CLICKS") problems.push(`type ${row.type} != UPLOAD_CLICKS`);
  if (row.status !== "ENABLED") problems.push(`status ${row.status}`);
  return problems;
}

export type ClickConversionBody = {
  conversionAction: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  conversionDateTime: string;
  conversionValue: number;
  currencyCode: string;
  orderId: string;
  consent: { adUserData: "GRANTED" };
};

/** "yyyy-mm-dd hh:mm:ss+|-hh:mm" in Europe/Zurich, as the Ads API requires. */
export function adsDateTime(d: Date, timeZone = "Europe/Zurich"): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "longOffset",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const offset = String(parts.timeZoneName ?? "GMT").replace("GMT", "") || "+00:00";
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

/**
 * @param value revenue (default) or, for the purchase_profit experiment, the clamped CM2 from
 *              secondaryProfitConversionValue(). Never mixed into the revenue action.
 */
export function buildSecondaryClickConversion(
  p: ShadowPurchase,
  customerId: string,
  conversionActionId: string,
  value: number,
): ClickConversionBody | null {
  if (isProductionId(conversionActionId)) throw new Error("refusing production conversion action");
  if (p.consent.marketing !== true) return null;
  const click = p.clickIds.gclid
    ? { gclid: p.clickIds.gclid }
    : p.clickIds.gbraid
      ? { gbraid: p.clickIds.gbraid }
      : p.clickIds.wbraid
        ? { wbraid: p.clickIds.wbraid }
        : null;
  if (!click) return null;
  return {
    conversionAction: `customers/${customerId}/conversionActions/${conversionActionId}`,
    ...click,
    conversionDateTime: adsDateTime(p.occurredAt),
    conversionValue: Math.max(0, Math.round(value * 100) / 100),
    currencyCode: p.currency,
    orderId: p.orderId,
    consent: { adUserData: "GRANTED" },
  };
}

export async function sendGoogleAdsSecondary(): Promise<never> {
  assertDestinationOpen("google_ads_secondary");
  throw new Error("Google Ads secondary transport not implemented before gate G4");
}
