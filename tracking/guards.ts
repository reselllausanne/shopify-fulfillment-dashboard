/**
 * Outbound tracking gates (docs/tracking/TRACKING-PLAN.md §9).
 *
 * Phase 1 is observation only: every outbound destination is locked in code. Lifting the lock
 * requires a reviewed PR that flips OUTBOUND_LOCKED for ONE destination after its approval
 * gate, plus env opt-in on the VPS. Production Simprosys ids are refused forever.
 */

export type Env = Record<string, string | undefined>;

export const OUTBOUND_LOCKED = {
  ga4_test: true,
  /** G4: code lock lifted — live upload still needs ENABLED=1 + APPROVED_AT + ACTION_ID. */
  google_ads_secondary: false,
  meta: true,
  tiktok: true,
} as const;

export type Destination = keyof typeof OUTBOUND_LOCKED;

/** Production ids owned by Simprosys — shadow code must never send to them. */
export const PRODUCTION_IDS = {
  ga4MeasurementId: "G-828PXC8REN",
  ga4PropertyId: "375669137",
  googleAdsTagId: "AW-11152326139",
  googleAdsConversionLabels: [
    "jO0PCITe3NUYEPv768Up", // Google Shopping App Purchase (primary)
    "lI4cCIre3NUYEPv768Up",
    "EwozCI3e3NUYEPv768Up",
    "1OhKCJDe3NUYEPv768Up",
    "6crpCJPe3NUYEPv768Up",
    "CIGZCJn9qa8bEPv768Up",
    "YZwVCOqStK8bEPv768Up",
    "68ABCLufiLsbEPv768Up",
    "ZazsCL6fiLsbEPv768Up",
    "6-KvCMGfiLsbEPv768Up",
    "yTMrCMKGirsbEPv768Up",
  ],
  /** Existing Google Ads conversion actions (any reuse would touch reporting/bidding). */
  googleAdsConversionActionIds: [
    "6599003656",
    "6622228228",
    "6622228234",
    "6622228237",
    "6622228240",
    "6622228243",
    "6641676935",
    "6641677868",
    "7347011225",
    "7347177834",
    "7371624379",
    "7371624382",
    "7371624385",
    "7371653954",
  ],
} as const;

const PROD_VALUES = new Set<string>([
  PRODUCTION_IDS.ga4MeasurementId,
  PRODUCTION_IDS.ga4PropertyId,
  PRODUCTION_IDS.googleAdsTagId,
  PRODUCTION_IDS.googleAdsTagId.replace(/^AW-/, ""),
  ...PRODUCTION_IDS.googleAdsConversionLabels,
  ...PRODUCTION_IDS.googleAdsConversionActionIds,
]);

export class OutboundLockedError extends Error {
  constructor(readonly destination: Destination, readonly reasons: string[]) {
    super(`Outbound tracking to ${destination} is locked: ${reasons.join("; ")}`);
    this.name = "OutboundLockedError";
  }
}

/** True when the value is (or embeds) a production Simprosys id. */
export function isProductionId(value: string | null | undefined): boolean {
  const v = String(value ?? "").trim();
  if (!v) return false;
  if (PROD_VALUES.has(v)) return true;
  for (const id of PROD_VALUES) if (v.includes(id)) return true;
  return false;
}

const DEST_ENV: Record<Destination, { ids: string[] }> = {
  ga4_test: { ids: ["TRACKING_GA4_TEST_MEASUREMENT_ID"] },
  google_ads_secondary: { ids: ["TRACKING_GOOGLE_ADS_SECONDARY_ACTION_ID"] },
  meta: { ids: ["TRACKING_META_PIXEL_ID"] },
  tiktok: { ids: ["TRACKING_TIKTOK_PIXEL_ID"] },
};

function envKey(dest: Destination, suffix: string): string {
  return `TRACKING_${dest.toUpperCase()}_${suffix}`;
}

export type GateResult = { open: boolean; reasons: string[] };

/**
 * Every condition must hold: code lock lifted, env enabled, approval date recorded,
 * destination ids present and none of them a production id.
 */
export function destinationGate(dest: Destination, env: Env = process.env): GateResult {
  const reasons: string[] = [];
  if (OUTBOUND_LOCKED[dest]) reasons.push("phase-1 code lock");
  if (String(env[envKey(dest, "ENABLED")] ?? "").trim() !== "1") reasons.push(`${envKey(dest, "ENABLED")}!=1`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(env[envKey(dest, "APPROVED_AT")] ?? "").trim())) {
    reasons.push(`${envKey(dest, "APPROVED_AT")} missing (YYYY-MM-DD of user approval)`);
  }
  for (const key of DEST_ENV[dest].ids) {
    const v = String(env[key] ?? "").trim();
    if (!v) reasons.push(`${key} missing`);
    else if (isProductionId(v)) reasons.push(`${key} is a production id`);
  }
  return { open: reasons.length === 0, reasons };
}

export function assertDestinationOpen(dest: Destination, env: Env = process.env): void {
  const gate = destinationGate(dest, env);
  if (!gate.open) throw new OutboundLockedError(dest, gate.reasons);
}
