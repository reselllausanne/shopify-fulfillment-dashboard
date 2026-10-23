/**
 * Google Ads SECONDARY test conversion (click upload) — gate G4.
 *
 * Only ever targets a NEW conversion action created for the experiment, verified Secondary
 * (primary_for_goal = false, not in the "Conversions" column used by bidding). Never one of the
 * existing Simprosys / GA4-imported actions.
 *
 * Code lock lifted; live upload still requires TRACKING_GOOGLE_ADS_SECONDARY_ENABLED=1 +
 * APPROVED_AT + ACTION_ID (non-prod) on the VPS.
 */
import type { AdsConfig } from "@/adsanalytics/config";
import { searchAll, type GoogleAdsRow } from "@/adsanalytics/google/adsClient";
import type { MutateResponse } from "@/adsanalytics/google/adsClient";
import { uploadClickConversions } from "@/adsanalytics/google/conversionUploads";
import { assertDestinationOpen, isProductionId, type Env } from "../guards";
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

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function boolish(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

/** Load one conversion_action row for validateSecondaryAction. */
export async function loadSecondaryActionCheck(
  config: AdsConfig,
  conversionActionId: string,
): Promise<ConversionActionCheck | null> {
  if (isProductionId(conversionActionId)) {
    throw new Error("refusing to load production conversion action");
  }
  const id = conversionActionId.replace(/\D/g, "");
  if (!id) return null;
  const { rows } = await searchAll(
    config,
    `
    SELECT
      conversion_action.id,
      conversion_action.name,
      conversion_action.status,
      conversion_action.type,
      conversion_action.primary_for_goal,
      conversion_action.include_in_conversions_metric
    FROM conversion_action
    WHERE conversion_action.id = ${id}
    `,
  );
  const row = rows[0] as GoogleAdsRow | undefined;
  if (!row) return null;
  const ca = (row.conversionAction ?? row.conversion_action ?? {}) as Record<string, unknown>;
  return {
    id: str(ca.id ?? id),
    name: str(ca.name),
    status: str(ca.status),
    type: str(ca.type),
    primaryForGoal: boolish(ca.primaryForGoal ?? ca.primary_for_goal),
    includeInConversionsMetric: boolish(
      ca.includeInConversionsMetric ?? ca.include_in_conversions_metric,
    ),
  };
}

export type SendSecondaryResult = {
  status: "uploaded" | "skipped" | "validate_only";
  body: ClickConversionBody | null;
  reason?: string;
  response?: MutateResponse;
};

export type SendSecondaryArgs = {
  purchase: ShadowPurchase;
  customerId: string;
  conversionActionId: string;
  /** Defaults to purchase.revenue. */
  value?: number;
  /** When set, must pass validateSecondaryAction before upload. */
  actionCheck?: ConversionActionCheck;
  env?: Env;
  /** Ads validateOnly — no persist. Default false. */
  validateOnly?: boolean;
  /** Inject for unit tests; defaults to uploadClickConversions. */
  uploadFn?: (
    config: AdsConfig,
    conversions: unknown[],
    options: { validateOnly?: boolean },
  ) => Promise<MutateResponse>;
  adsConfig?: AdsConfig;
};

/**
 * Upload one Secondary click conversion. Gate must be open (code + env).
 * Skips (no throw) when marketing consent or click id missing.
 */
export async function sendGoogleAdsSecondary(args: SendSecondaryArgs): Promise<SendSecondaryResult> {
  assertDestinationOpen("google_ads_secondary", args.env);

  if (args.actionCheck) {
    const problems = validateSecondaryAction(args.actionCheck);
    if (problems.length) {
      throw new Error(`Secondary action rejected: ${problems.join("; ")}`);
    }
  }

  const value = args.value ?? args.purchase.revenue;
  const body = buildSecondaryClickConversion(
    args.purchase,
    args.customerId,
    args.conversionActionId,
    value,
  );
  if (!body) {
    return { status: "skipped", body: null, reason: "no_marketing_consent_or_click_id" };
  }

  const upload = args.uploadFn;
  if (!upload && !args.adsConfig) {
    throw new Error("sendGoogleAdsSecondary requires adsConfig (or uploadFn in tests)");
  }
  const config =
    args.adsConfig ??
    ({
      developerToken: "",
      clientId: "",
      clientSecret: "",
      refreshToken: "",
      loginCustomerId: null,
      customerId: args.customerId,
      apiVersion: "v25",
      timezone: "Europe/Zurich",
    } satisfies AdsConfig);

  const response = await (upload ?? uploadClickConversions)(config, [body], {
    validateOnly: args.validateOnly === true,
  });

  return {
    status: args.validateOnly ? "validate_only" : "uploaded",
    body,
    response,
  };
}
