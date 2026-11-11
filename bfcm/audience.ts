import {
  BF2026_SCHEDULE,
  CAMPAIGN_SEND_AT,
  type CampaignFile,
} from "@/bfcm/schedule";

export type ConsentState =
  | "subscribed"
  | "unsubscribed"
  | "suppressed"
  | "pending"
  | "never_subscribed";

export type AudienceProfile = {
  consent: ConsentState;
  bfConfirmed: boolean;
  bfConfirmedAt: string | null;
  confirmationSentAt: string | null;
  liquidationPurchasedSinceVipOpen: boolean;
  usefulInterest: boolean;
  marketingHold: boolean;
  bf2026Excluded: boolean;
  relevantOfferAvailable: boolean;
};

export type DecisionReason =
  | "send"
  | "native_suppression"
  | "service_or_manual_exclusion"
  | "liquidation_purchased"
  | "not_bf_confirmed"
  | "already_bf_confirmed"
  | "recent_confirmation_quiet"
  | "not_interested"
  | "no_relevant_offer"
  | "end_not_enforced"
  | "vip_excluded_from_public_open";

export type CampaignDecision = {
  send: boolean;
  reason: DecisionReason;
  variant?: "vip_preview" | "signup_reminder";
};

export type CampaignContext = {
  sendAt?: string;
  endEnforced?: boolean;
};

const BUYER_EXCLUSION = new Set<CampaignFile>([
  "05_ouverture_publique",
  "06_rappel_vendredi",
  "07_disponibilites_weekend",
  "08_cloture",
]);

function confirmedAt(profile: AudienceProfile, sendAt: string): boolean {
  if (!profile.bfConfirmed) return false;
  if (!profile.bfConfirmedAt) return true;
  const confirmed = Date.parse(profile.bfConfirmedAt);
  const sent = Date.parse(sendAt);
  return !Number.isFinite(confirmed) || !Number.isFinite(sent)
    ? true
    : confirmed <= sent;
}

function inPreparationQuietWindow(
  profile: AudienceProfile,
  sendAt: string,
): boolean {
  const sent = Date.parse(sendAt);
  const quietMs = BF2026_SCHEDULE.preparationQuietHours * 60 * 60 * 1000;
  return [profile.bfConfirmedAt, profile.confirmationSentAt].some((stamp) => {
    if (!stamp) return false;
    const event = Date.parse(stamp);
    const delta = sent - event;
    return Number.isFinite(event) && delta >= 0 && delta < quietMs;
  });
}

function targeted(profile: AudienceProfile): CampaignDecision {
  if (!profile.usefulInterest) {
    return { send: false, reason: "not_interested" };
  }
  if (!profile.relevantOfferAvailable) {
    return { send: false, reason: "no_relevant_offer" };
  }
  return { send: true, reason: "send" };
}

/**
 * Priority is fixed:
 * native consent/suppression → SAV/manual hold → purchase → campaign audience.
 * Personalization happens only after this decision.
 */
export function decideCampaign(
  profile: AudienceProfile,
  campaign: CampaignFile,
  context: CampaignContext = {},
): CampaignDecision {
  if (profile.consent !== "subscribed") {
    return { send: false, reason: "native_suppression" };
  }
  if (profile.marketingHold || profile.bf2026Excluded) {
    return { send: false, reason: "service_or_manual_exclusion" };
  }
  if (
    BUYER_EXCLUSION.has(campaign) &&
    profile.liquidationPurchasedSinceVipOpen
  ) {
    return { send: false, reason: "liquidation_purchased" };
  }

  const sendAt = context.sendAt ?? CAMPAIGN_SEND_AT[campaign];
  const vip = confirmedAt(profile, sendAt);

  switch (campaign) {
    case "01_selection_novembre":
      return { send: true, reason: "send" };
    case "02_invitation":
      return vip
        ? { send: false, reason: "already_bf_confirmed" }
        : { send: true, reason: "send" };
    case "03_apercu_et_inscription":
      if (!vip) {
        return {
          send: true,
          reason: "send",
          variant: "signup_reminder",
        };
      }
      if (inPreparationQuietWindow(profile, sendAt)) {
        return { send: false, reason: "recent_confirmation_quiet" };
      }
      return { send: true, reason: "send", variant: "vip_preview" };
    case "04_acces_vip":
      return vip
        ? { send: true, reason: "send" }
        : { send: false, reason: "not_bf_confirmed" };
    case "05_ouverture_publique":
      return vip
        ? { send: false, reason: "vip_excluded_from_public_open" }
        : { send: true, reason: "send" };
    case "06_rappel_vendredi":
    case "07_disponibilites_weekend":
      return targeted(profile);
    case "08_cloture":
      return context.endEnforced
        ? targeted(profile)
        : { send: false, reason: "end_not_enforced" };
  }
}

export function fridayCampaigns(
  profile: AudienceProfile,
): CampaignFile[] {
  return (
    ["05_ouverture_publique", "06_rappel_vendredi"] as const
  ).filter((campaign) => decideCampaign(profile, campaign).send);
}

export function smartSendingExceptionAllowed(
  campaign: CampaignFile,
): boolean {
  return (
    campaign === "04_acces_vip" || campaign === "06_rappel_vendredi"
  );
}

export function exceptionBypassesSuppressionOrHold(): false {
  return false;
}

export function serviceMessageAllowed(): true {
  return true;
}

export function clickIsUseful(botClick: boolean | null): boolean {
  return botClick === false;
}

export function openIsUsefulInterest(): false {
  return false;
}
