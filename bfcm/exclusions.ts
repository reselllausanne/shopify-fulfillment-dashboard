import { BF2026_SCHEDULE } from "@/bfcm/schedule";

export const GMAIL_LABELS = {
  bfExclude: "BFCM/EXCLURE",
  review: "MARKETING/A_VERIFIER",
  sav: "MARKETING/BLOQUE_SAV",
} as const;

export const REVIEW_ONLY_LABELS = [
  "Client/Traités",
  "Client/En attente retour",
  "Salohy/attente retour Theo",
] as const;

export type HoldScope = "marketing" | "bf_2026";
export type HoldState = "active" | "released";
export type HoldReason =
  | "manual_bf_exclusion"
  | "review_pending"
  | "late_order"
  | "refund_pending"
  | "invoice_dispute"
  | "open_claim"
  | "open_return";
export type HoldSource =
  | "gmail_label"
  | "backend_signal"
  | "manual_review";

export type HoldEntry = {
  id: string;
  profileEmail: string;
  scope: HoldScope;
  reason: HoldReason;
  source: HoldSource;
  sourceRef: string;
  state: HoldState;
  decidedBy: string;
  decidedAt: string;
  releasedBy: string | null;
  releasedAt: string | null;
};

export type ExclusionProperties = Partial<{
  rl_bf_2026_excluded: true;
  rl_marketing_hold: true;
  rl_marketing_hold_reason: HoldReason;
  rl_marketing_hold_source: HoldSource;
}>;

const NON_CUSTOMER_DOMAINS = [
  "resell-lausanne.ch",
  "stockx.com",
  "goat.com",
  "galaxus.ch",
  "digitec.ch",
  "decathlon.com",
  "decathlon.ch",
  "mirakl.net",
  "post.ch",
  "swisspost.ch",
  "dhl.com",
  "ups.com",
] as const;

const EMAIL = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/;

export function customerEmail(value: string): string | null {
  const angled = value.trim().match(/<([^>]+)>/);
  const email = (angled?.[1] ?? value).trim().toLowerCase();
  if (!EMAIL.test(email)) return null;
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (
    NON_CUSTOMER_DOMAINS.some(
      (blocked) => domain === blocked || domain.endsWith(`.${blocked}`),
    )
  ) {
    return null;
  }
  return email;
}

/**
 * Lowercase only. Gmail dots and + suffixes stay. Similar names never merge.
 */
export function profileIdentity(
  candidates: readonly string[],
):
  | { status: "resolved"; email: string }
  | { status: "review"; reason: "none" | "ambiguous" } {
  const emails = new Set(
    candidates
      .map(customerEmail)
      .filter((email): email is string => email !== null),
  );
  if (emails.size === 1) {
    return { status: "resolved", email: [...emails][0]! };
  }
  return {
    status: "review",
    reason: emails.size === 0 ? "none" : "ambiguous",
  };
}

export function keywordsCreateExclusion(): false {
  return false;
}

export function mailboxStateReleasesHold(): false {
  return false;
}

export function aggregateExclusions(
  entries: readonly HoldEntry[],
  profileEmail: string,
): ExclusionProperties {
  const active = entries.filter(
    (entry) =>
      entry.profileEmail === profileEmail && entry.state === "active",
  );
  const result: ExclusionProperties = {};
  if (active.some((entry) => entry.scope === "bf_2026")) {
    result.rl_bf_2026_excluded = true;
  }
  const marketing = active.find((entry) => entry.scope === "marketing");
  if (marketing) {
    result.rl_marketing_hold = true;
    result.rl_marketing_hold_reason = marketing.reason;
    result.rl_marketing_hold_source = marketing.source;
  }
  return result;
}

/** Explicit review releases one case. Other active cases remain. */
export function releaseHold(
  entries: readonly HoldEntry[],
  id: string,
  actor: string,
  at: string,
): HoldEntry[] {
  if (!actor.trim() || !Number.isFinite(Date.parse(at))) {
    throw new Error("Release requires actor and date");
  }
  let found = false;
  const next = entries.map((entry) => {
    if (entry.id !== id) return entry;
    found = true;
    return {
      ...entry,
      state: "released" as const,
      releasedBy: actor.trim(),
      releasedAt: at,
    };
  });
  if (!found) throw new Error("Unknown hold");
  return next;
}

/** Missing source rows or labels never clear prior decisions. */
export function retainExistingHolds(
  entries: readonly HoldEntry[],
): HoldEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

export type SourceHealth = {
  critical: boolean;
  available: boolean;
  ageMinutes: number | null;
};

export function automatedSendGate(
  sources: readonly SourceHealth[],
): {
  allow: boolean;
  retainExistingHolds: true;
  replaceUnavailableWithEmpty: false;
  reason: "ok" | "missing" | "unavailable" | "stale";
} {
  const critical = sources.filter((source) => source.critical);
  const base = {
    retainExistingHolds: true as const,
    replaceUnavailableWithEmpty: false as const,
  };
  if (critical.length === 0) {
    return { allow: false, ...base, reason: "missing" };
  }
  if (critical.some((source) => !source.available)) {
    return { allow: false, ...base, reason: "unavailable" };
  }
  if (
    critical.some(
      (source) =>
        source.ageMinutes === null ||
        source.ageMinutes > BF2026_SCHEDULE.sourceFreshnessMinutes,
    )
  ) {
    return { allow: false, ...base, reason: "stale" };
  }
  return { allow: true, ...base, reason: "ok" };
}

export function exclusionMutationMaySubscribe(): false {
  return false;
}
