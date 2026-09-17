import { describe, expect, it } from "vitest";
import {
  inboundRetentionRankAt,
  resolveStockxInboundLogisticsAt,
} from "@/app/lib/stockxInboundPackages";

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

describe("resolveStockxInboundLogisticsAt", () => {
  it("prefers deliveredDate over ETA and ship-by", () => {
    const delivered = new Date("2026-09-12T08:00:00Z");
    expect(
      resolveStockxInboundLogisticsAt({
        deliveredDate: delivered,
        latestEstimatedDeliveryDate: "2026-09-15T00:00:00Z",
        estimatedDeliveryDate: "2026-09-14T00:00:00Z",
        purchaseDate: "2026-09-01T00:00:00Z",
      })?.toISOString()
    ).toBe(delivered.toISOString());
  });

  it("uses ETA when deliveredDate missing — never purchaseDate", () => {
    const eta = new Date("2026-09-14T00:00:00Z");
    const purchase = "2026-09-01T10:00:00Z";
    const result = resolveStockxInboundLogisticsAt({
      deliveredDate: null,
      latestEstimatedDeliveryDate: eta,
      purchaseDate: purchase,
      creationDate: purchase,
    });
    expect(result?.toISOString()).toBe(eta.toISOString());
    expect(result?.toISOString()).not.toBe(new Date(purchase).toISOString());
  });

  it("returns null when only purchaseDate/creationDate exist", () => {
    expect(
      resolveStockxInboundLogisticsAt({
        purchaseDate: "2026-09-01T10:00:00Z",
        creationDate: "2026-09-01T10:00:00Z",
      })
    ).toBeNull();
  });

  it("falls back to sellerShipBy when no delivered/ETA", () => {
    const shipBy = new Date("2026-09-10T12:00:00Z");
    expect(
      resolveStockxInboundLogisticsAt({
        sellerShipByActual: shipBy,
        purchaseDate: "2026-09-01T00:00:00Z",
      })?.toISOString()
    ).toBe(shipBy.toISOString());
  });
});
