export const BF2026_TIMEZONE = "Europe/Zurich" as const;

export const BF2026_SCHEDULE = {
  timezone: BF2026_TIMEZONE,
  vipOpenAt: "2026-11-26T19:00:00+01:00",
  publicOpenAt: "2026-11-27T09:00:00+01:00",
  endAt: "2026-11-30T23:59:59+01:00",
  preparationQuietHours: 24,
  sourceFreshnessMinutes: 5,
  maxExplicitSizes: 3,
  maxFridayCampaigns: 2,
} as const;

export const CAMPAIGN_SEND_AT = {
  "01_selection_novembre": "2026-11-12T18:30:00+01:00",
  "02_invitation": "2026-11-15T18:30:00+01:00",
  "03_apercu_et_inscription": "2026-11-22T18:30:00+01:00",
  "04_acces_vip": BF2026_SCHEDULE.vipOpenAt,
  "05_ouverture_publique": BF2026_SCHEDULE.publicOpenAt,
  "06_rappel_vendredi": "2026-11-27T18:30:00+01:00",
  "07_disponibilites_weekend": "2026-11-29T18:00:00+01:00",
  "08_cloture": "2026-11-30T18:30:00+01:00",
} as const;

export type CampaignFile = keyof typeof CAMPAIGN_SEND_AT;
export type EditorialCampaignFile = Exclude<
  CampaignFile,
  "01_selection_novembre" | "02_invitation"
>;
export type CampaignPhase = "prepare" | "vip" | "public" | "ended";

export function campaignPhase(
  now: Date | string,
  schedule = BF2026_SCHEDULE,
): CampaignPhase {
  const current = new Date(now).getTime();
  const vip = Date.parse(schedule.vipOpenAt);
  const publicOpen = Date.parse(schedule.publicOpenAt);
  const end = Date.parse(schedule.endAt);
  if (
    ![current, vip, publicOpen, end].every(Number.isFinite) ||
    !(vip < publicOpen && publicOpen < end)
  ) {
    throw new Error("Invalid BFCM schedule");
  }
  if (current < vip) return "prepare";
  if (current < publicOpen) return "vip";
  if (current <= end) return "public";
  return "ended";
}

export function canPurchase(phase: CampaignPhase, confirmedVip: boolean): boolean {
  return phase === "public" || (phase === "vip" && confirmedVip);
}

export const OPENING_SEND_MODE = {
  mode: "fixed",
  timezone: BF2026_TIMEZONE,
  recipientLocalTime: false,
  optimizedTime: false,
} as const;
