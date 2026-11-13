import { describe, expect, it } from "vitest";
import {
  evaluatePartnerFeedStaleness,
  type PartnerFeedLastImport,
} from "@/galaxus/ops/partnerFeedHealth";

const NOW = Date.parse("2026-11-13T14:00:00.000Z");
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function row(partial: Partial<PartnerFeedLastImport>): PartnerFeedLastImport {
  return {
    partnerId: "p",
    partnerName: "name",
    partnerKey: "NER",
    lastCompletedAt: null,
    lastAttemptAt: null,
    ...partial,
  };
}

describe("evaluatePartnerFeedStaleness", () => {
  it("flags NER: uploading today, last success 7d ago", () => {
    const stale = evaluatePartnerFeedStaleness(
      [
        row({
          lastAttemptAt: new Date(NOW - 1 * HOUR),
          lastCompletedAt: new Date(NOW - 7 * DAY),
        }),
      ],
      NOW
    );
    expect(stale).toHaveLength(1);
    expect(stale[0]!.partnerKey).toBe("NER");
    expect(stale[0]!.hoursSinceSuccess).toBe(168);
  });

  it("healthy feed (imported 1h ago) is not stale", () => {
    const stale = evaluatePartnerFeedStaleness(
      [row({ lastAttemptAt: new Date(NOW - 1 * HOUR), lastCompletedAt: new Date(NOW - 1 * HOUR) })],
      NOW
    );
    expect(stale).toHaveLength(0);
  });

  it("retired feed (no recent upload) is ignored even if last success is old", () => {
    const stale = evaluatePartnerFeedStaleness(
      [row({ lastAttemptAt: new Date(NOW - 30 * DAY), lastCompletedAt: new Date(NOW - 30 * DAY) })],
      NOW
    );
    expect(stale).toHaveLength(0);
  });

  it("active feed that NEVER completed is stale with null hours", () => {
    const stale = evaluatePartnerFeedStaleness(
      [row({ lastAttemptAt: new Date(NOW - 2 * HOUR), lastCompletedAt: null })],
      NOW
    );
    expect(stale).toHaveLength(1);
    expect(stale[0]!.hoursSinceSuccess).toBeNull();
  });

  it("just under 2 days is not stale", () => {
    const stale = evaluatePartnerFeedStaleness(
      [row({ lastAttemptAt: new Date(NOW - 1 * HOUR), lastCompletedAt: new Date(NOW - 47 * HOUR) })],
      NOW
    );
    expect(stale).toHaveLength(0);
  });
});
