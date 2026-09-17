import { describe, expect, it } from "vitest";
import { inboundRetentionRankAt } from "@/app/lib/stockxInboundPackages";

describe("inboundRetentionRankAt", () => {
  it("prefers stockxEventAt over firstSeenAt and arrivedAt", () => {
    const event = new Date("2026-09-01T10:00:00Z");
    const first = new Date("2026-09-10T10:00:00Z");
    const arrived = new Date("2026-09-17T16:00:00Z"); // cron tick — must not win
    expect(
      inboundRetentionRankAt({
        stockxEventAt: event,
        firstSeenAt: first,
        arrivedAt: arrived,
      }).toISOString()
    ).toBe(event.toISOString());
  });

  it("falls back to firstSeenAt when stockxEventAt missing", () => {
    const first = new Date("2026-09-05T12:00:00Z");
    const arrived = new Date("2026-09-17T16:00:00Z");
    expect(
      inboundRetentionRankAt({
        stockxEventAt: null,
        firstSeenAt: first,
        arrivedAt: arrived,
      }).toISOString()
    ).toBe(first.toISOString());
  });

  it("never ranks by last cron arrivedAt when firstSeenAt exists", () => {
    const first = new Date("2026-08-01T00:00:00Z");
    const cron = new Date("2026-09-17T16:50:00Z");
    const rank = inboundRetentionRankAt({
      stockxEventAt: null,
      firstSeenAt: first,
      arrivedAt: cron,
    });
    expect(rank.getTime()).toBe(first.getTime());
    expect(rank.getTime()).not.toBe(cron.getTime());
  });
});
