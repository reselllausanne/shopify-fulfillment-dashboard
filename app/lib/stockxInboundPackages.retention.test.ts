import { describe, expect, it } from "vitest";
import {
  inboundRetentionRankAt,
  resolveStockxInboundLogisticsAt,
} from "@/app/lib/stockxInboundPackages";

const NOW = new Date("2026-09-17T15:00:00.000Z");

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

describe("resolveStockxInboundLogisticsAt (observed only)", () => {
  it("ETA future alone => stockxEventAt=null, source first_seen; rank firstSeenAt", () => {
    const firstSeen = new Date("2026-09-10T08:00:00Z");
    const futureEta = "2026-09-25T00:00:00Z";
    const logistics = resolveStockxInboundLogisticsAt({
      estimatedDeliveryDate: futureEta,
      latestEstimatedDeliveryDate: futureEta,
      now: NOW,
    });
    expect(logistics.stockxEventAt).toBeNull();
    expect(logistics.source).toBe("first_seen");
    expect(
      inboundRetentionRankAt({
        stockxEventAt: logistics.stockxEventAt,
        firstSeenAt: firstSeen,
      }).toISOString()
    ).toBe(firstSeen.toISOString());
  });

  it("sellerShipBy future alone => stockxEventAt=null, rank firstSeenAt", () => {
    const firstSeen = new Date("2026-09-11T09:00:00Z");
    const logistics = resolveStockxInboundLogisticsAt({
      sellerShipByActual: "2026-09-20T00:00:00Z",
      sellerShipByEnd: "2026-09-22T00:00:00Z",
      sellerShipByStart: "2026-09-18T00:00:00Z",
      now: NOW,
    });
    expect(logistics.stockxEventAt).toBeNull();
    expect(logistics.source).toBe("first_seen");
    expect(
      inboundRetentionRankAt({
        stockxEventAt: logistics.stockxEventAt,
        firstSeenAt: firstSeen,
      }).toISOString()
    ).toBe(firstSeen.toISOString());
  });

  it("delivered real beats shipped real", () => {
    const delivered = new Date("2026-09-12T08:00:00Z");
    const shipped = new Date("2026-09-10T08:00:00Z");
    const logistics = resolveStockxInboundLogisticsAt({
      deliveredDate: delivered,
      shippedAt: shipped,
      estimatedDeliveryDate: "2026-09-25T00:00:00Z",
      purchaseDate: "2026-09-01T00:00:00Z",
      now: NOW,
    });
    expect(logistics.source).toBe("delivered");
    expect(logistics.stockxEventAt?.toISOString()).toBe(delivered.toISOString());
  });

  it("shipped real => rank shippedAt", () => {
    const shipped = new Date("2026-09-10T12:00:00Z");
    const firstSeen = new Date("2026-09-11T00:00:00Z");
    const logistics = resolveStockxInboundLogisticsAt({
      shippedAt: shipped,
      now: NOW,
    });
    expect(logistics.source).toBe("shipped");
    expect(logistics.stockxEventAt?.toISOString()).toBe(shipped.toISOString());
    expect(
      inboundRetentionRankAt({
        stockxEventAt: logistics.stockxEventAt,
        firstSeenAt: firstSeen,
      }).toISOString()
    ).toBe(shipped.toISOString());
  });

  it("purchaseDate alone => never stockxEventAt", () => {
    const logistics = resolveStockxInboundLogisticsAt({
      purchaseDate: "2026-09-01T10:00:00Z",
      creationDate: "2026-09-01T10:00:00Z",
      now: NOW,
    });
    expect(logistics.stockxEventAt).toBeNull();
    expect(logistics.source).toBe("first_seen");
  });

  it("tracking event used when no delivered/shipped", () => {
    const tracking = new Date("2026-09-09T15:00:00Z");
    const logistics = resolveStockxInboundLogisticsAt({
      trackingEventAt: tracking,
      purchaseDate: "2026-09-01T00:00:00Z",
      now: NOW,
    });
    expect(logistics.source).toBe("tracking");
    expect(logistics.stockxEventAt?.toISOString()).toBe(tracking.toISOString());
  });

  it("confirming StockX state timestamp used as state source", () => {
    const stateAt = new Date("2026-09-08T11:00:00Z");
    const logistics = resolveStockxInboundLogisticsAt({
      stateConfirmedAt: stateAt,
      stateStatusKey: "SHIPPED",
      now: NOW,
    });
    expect(logistics.source).toBe("state");
    expect(logistics.stockxEventAt?.toISOString()).toBe(stateAt.toISOString());
  });

  it("state.changedAt / updatedAt used as priority-4 logistics date", () => {
    // User rule: after delivered → shipped → tracking, use state.changedAt/updatedAt.
    const logistics = resolveStockxInboundLogisticsAt({
      stateConfirmedAt: "2026-09-08T11:00:00Z",
      stateStatusKey: "PENDING", // confirming path skipped
      stateChangedAt: "2026-09-08T11:00:00Z",
      stateUpdatedAt: "2026-09-07T11:00:00Z",
      now: NOW,
    });
    expect(logistics.source).toBe("state");
    expect(logistics.stockxEventAt?.toISOString()).toBe(
      new Date("2026-09-08T11:00:00Z").toISOString()
    );
  });

  it("never assigns stockxEventAt from purchaseDate ?? creationDate", () => {
    const banned = "2026-09-01T10:00:00Z";
    const logistics = resolveStockxInboundLogisticsAt({
      purchaseDate: banned,
      creationDate: banned,
      now: NOW,
    });
    expect(logistics.stockxEventAt).toBeNull();
    expect(logistics.source).toBe("first_seen");
  });
});
