import { describe, expect, it } from "vitest";
import { decideMilestoneEmail } from "@/app/lib/notifications/milestoneEmailGate";

describe("decideMilestoneEmail", () => {
  const base = {
    milestoneKey: "PURCHASE_CONFIRMED",
    previousLastMilestoneKey: null as string | null,
    isInboundDeliveryMilestone: false,
    emailedAt: null as Date | null,
    autoSendEmails: true,
  };

  it("sends on new milestone not yet emailed", () => {
    expect(decideMilestoneEmail(base)).toEqual({
      shouldSend: true,
      shouldUpsertEvent: true,
      reason: "send",
    });
  });

  it("skips rematch when milestone equals lastMilestoneKey (no reblast)", () => {
    expect(
      decideMilestoneEmail({
        ...base,
        previousLastMilestoneKey: "PURCHASE_CONFIRMED",
      })
    ).toEqual({
      shouldSend: false,
      shouldUpsertEvent: false,
      reason: "same_as_last",
    });
  });

  it("skips send when StockXStatusEvent.emailedAt is set", () => {
    expect(
      decideMilestoneEmail({
        ...base,
        emailedAt: new Date("2026-10-01T12:00:00Z"),
      })
    ).toEqual({
      shouldSend: false,
      shouldUpsertEvent: true,
      reason: "already_emailed",
    });
  });

  it("skips inbound warehouse delivery milestones", () => {
    expect(
      decideMilestoneEmail({
        ...base,
        milestoneKey: "DELIVERED_TO_WAREHOUSE",
        isInboundDeliveryMilestone: true,
      })
    ).toEqual({
      shouldSend: false,
      shouldUpsertEvent: false,
      reason: "inbound_skip",
    });
  });

  it("records event but does not send when AUTO_SEND_EMAILS is false", () => {
    expect(decideMilestoneEmail({ ...base, autoSendEmails: false })).toEqual({
      shouldSend: false,
      shouldUpsertEvent: true,
      reason: "auto_send_disabled",
    });
  });

  it("skips when no milestone detected", () => {
    expect(decideMilestoneEmail({ ...base, milestoneKey: null })).toEqual({
      shouldSend: false,
      shouldUpsertEvent: false,
      reason: "no_milestone",
    });
  });
});
