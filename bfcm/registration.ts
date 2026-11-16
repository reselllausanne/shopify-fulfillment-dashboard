import type { ConsentState } from "@/bfcm/audience";
import type { CampaignPhase } from "@/bfcm/schedule";

export type RegistrationCause =
  | "form_submit"
  | "get"
  | "size_click"
  | "preference_update"
  | "duplicate_post"
  | "import"
  | "newsletter_only";

export function sizeClick(): {
  preselect: true;
  persist: false;
  subscribe: false;
  confirmBf: false;
} {
  return {
    preselect: true,
    persist: false,
    subscribe: false,
    confirmBf: false,
  };
}

/**
 * One acknowledgement after false → true confirmation. A queued API response,
 * GET, click, import, duplicate POST, or size update cannot trigger it.
 */
export function confirmationDecision(input: {
  cause: RegistrationCause;
  previousConfirmed: boolean;
  nextConfirmed: boolean;
  alreadySent: boolean;
  consent: ConsentState;
  marketingHold: boolean;
  bf2026Excluded: boolean;
  phase: CampaignPhase;
}): {
  send: boolean;
  promiseEmail: boolean;
  reason:
    | "send"
    | "suppressed"
    | "held"
    | "not_transition"
    | "pending"
    | "already_sent"
    | "ended";
} {
  if (input.consent !== "subscribed") {
    return { send: false, promiseEmail: false, reason: "suppressed" };
  }
  if (input.marketingHold || input.bf2026Excluded) {
    return { send: false, promiseEmail: false, reason: "held" };
  }
  if (input.cause !== "form_submit" || input.previousConfirmed) {
    return { send: false, promiseEmail: true, reason: "not_transition" };
  }
  if (!input.nextConfirmed) {
    return { send: false, promiseEmail: true, reason: "pending" };
  }
  if (input.alreadySent) {
    return { send: false, promiseEmail: true, reason: "already_sent" };
  }
  if (input.phase === "ended") {
    return { send: false, promiseEmail: false, reason: "ended" };
  }
  return { send: true, promiseEmail: true, reason: "send" };
}
