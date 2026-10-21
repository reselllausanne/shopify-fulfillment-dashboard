/**
 * Pure gate for StockX milestone customer emails.
 * Rematch / enrich / save-match must never reblast a milestone already emailed.
 */

export type MilestoneEmailGateInput = {
  milestoneKey: string | null | undefined;
  previousLastMilestoneKey: string | null | undefined;
  isInboundDeliveryMilestone: boolean;
  /** Set after a successful send on StockXStatusEvent. */
  emailedAt: Date | string | null | undefined;
  autoSendEmails: boolean;
};

export type MilestoneEmailGateReason =
  | "no_milestone"
  | "same_as_last"
  | "inbound_skip"
  | "already_emailed"
  | "auto_send_disabled"
  | "send";

export type MilestoneEmailGateResult = {
  shouldSend: boolean;
  /** When false before upsert, skip creating/updating the event entirely. */
  shouldUpsertEvent: boolean;
  reason: MilestoneEmailGateReason;
};

/**
 * Decide whether to record a milestone event and/or send email.
 * Order mirrors save-match: skip upsert for no/same/inbound; after upsert,
 * skip send when already emailed or auto-send off.
 */
export function decideMilestoneEmail(input: MilestoneEmailGateInput): MilestoneEmailGateResult {
  const milestoneKey = String(input.milestoneKey ?? "").trim() || null;
  if (!milestoneKey) {
    return { shouldSend: false, shouldUpsertEvent: false, reason: "no_milestone" };
  }
  if (milestoneKey === (input.previousLastMilestoneKey ?? null)) {
    return { shouldSend: false, shouldUpsertEvent: false, reason: "same_as_last" };
  }
  if (input.isInboundDeliveryMilestone) {
    return { shouldSend: false, shouldUpsertEvent: false, reason: "inbound_skip" };
  }
  if (input.emailedAt) {
    return { shouldSend: false, shouldUpsertEvent: true, reason: "already_emailed" };
  }
  if (!input.autoSendEmails) {
    return { shouldSend: false, shouldUpsertEvent: true, reason: "auto_send_disabled" };
  }
  return { shouldSend: true, shouldUpsertEvent: true, reason: "send" };
}
