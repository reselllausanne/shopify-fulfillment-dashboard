import { describe, expect, it } from "vitest";
import {
  evaluatePrecheck,
  isStockxAutoBuyExcluded,
  type SupplierVariantSnapshot,
} from "@/lib/stockxAutoCheckout/precheckAvailability";

const NOW = new Date("2026-10-24T12:00:00.000Z");

function variant(overrides: Partial<SupplierVariantSnapshot> = {}): SupplierVariantSnapshot {
  return {
    supplierVariantId: "stx_abc",
    stock: 3,
    price: 200,
    standardBuyPrice: 200,
    expressBuyPrice: 230,
    lastSyncAt: NOW,
    ...overrides,
  };
}

describe("evaluatePrecheck", () => {
  it("no variant → no_variant_match", () => {
    const r = evaluatePrecheck({ variant: null, sellChf: 300, desiredLane: "STANDARD", now: NOW });
    expect(r.status).toBe("no_variant_match");
    expect(r.expectedBuyChf).toBeNull();
    expect(r.supplierVariantId).toBeNull();
  });

  it("stock <= 0 → oos_no_ask (before any price logic)", () => {
    const r = evaluatePrecheck({
      variant: variant({ stock: 0 }),
      sellChf: 300,
      desiredLane: "STANDARD",
      now: NOW,
    });
    expect(r.status).toBe("oos_no_ask");
    expect(r.stock).toBe(0);
  });

  it("standard lane, healthy margin, fresh → buyable", () => {
    const r = evaluatePrecheck({
      variant: variant({ standardBuyPrice: 200 }),
      sellChf: 300,
      desiredLane: "STANDARD",
      now: NOW,
    });
    expect(r.status).toBe("buyable");
    expect(r.lane).toBe("STANDARD");
    expect(r.expectedBuyChf).toBe(200);
    expect(r.marginPct).toBeCloseTo(0.3333, 3);
  });

  it("express lane picks expressBuyPrice", () => {
    const r = evaluatePrecheck({
      variant: variant({ expressBuyPrice: 230 }),
      sellChf: 400,
      desiredLane: "EXPRESS",
      now: NOW,
    });
    expect(r.status).toBe("buyable");
    expect(r.lane).toBe("EXPRESS");
    expect(r.expectedBuyChf).toBe(230);
  });

  it("express desired but express missing → base price fallback + standard_only note", () => {
    const r = evaluatePrecheck({
      variant: variant({ expressBuyPrice: null, standardBuyPrice: 210, price: 205 }),
      sellChf: 400,
      desiredLane: "EXPRESS",
      now: NOW,
    });
    expect(r.expectedBuyChf).toBe(205);
    expect(r.detail).toContain("standard_only");
    expect(r.detail).toContain("used base price fallback");
    expect(r.status).toBe("buyable");
  });

  it("margin below floor → too_expensive", () => {
    const r = evaluatePrecheck({
      variant: variant({ standardBuyPrice: 290 }),
      sellChf: 300,
      desiredLane: "STANDARD",
      marginFloorPct: 0.05,
      now: NOW,
    });
    expect(r.status).toBe("too_expensive");
    expect(r.marginPct).toBeCloseTo(0.0333, 3);
  });

  it("stale lastSyncAt (checked after margin) → stale_data", () => {
    const stale = new Date(NOW.getTime() - 48 * 3_600_000);
    const r = evaluatePrecheck({
      variant: variant({ standardBuyPrice: 200, lastSyncAt: stale }),
      sellChf: 300,
      desiredLane: "STANDARD",
      staleHours: 24,
      now: NOW,
    });
    expect(r.status).toBe("stale_data");
  });

  it("feed live but row lastSyncAt old → buyable (change-only lastSyncAt ignored)", () => {
    const oldRow = new Date(NOW.getTime() - 30 * 24 * 3_600_000); // 30d since last value change
    const feedFresh = new Date(NOW.getTime() - 10 * 60_000); // SSE updated 10 min ago
    const r = evaluatePrecheck({
      variant: variant({ standardBuyPrice: 200, lastSyncAt: oldRow }),
      sellChf: 300,
      desiredLane: "STANDARD",
      staleHours: 24,
      feedLastSyncAt: feedFresh,
      now: NOW,
    });
    expect(r.status).toBe("buyable");
  });

  it("feed silent beyond staleHours → stale_data regardless of row", () => {
    const feedSilent = new Date(NOW.getTime() - 48 * 3_600_000);
    const r = evaluatePrecheck({
      variant: variant({ standardBuyPrice: 200, lastSyncAt: NOW }),
      sellChf: 300,
      desiredLane: "STANDARD",
      staleHours: 24,
      feedLastSyncAt: feedSilent,
      now: NOW,
    });
    expect(r.status).toBe("stale_data");
    expect(r.detail).toContain("SSE down");
  });

  it("no feed heartbeat (null) → stale_data (never synced)", () => {
    const r = evaluatePrecheck({
      variant: variant({ standardBuyPrice: 200, lastSyncAt: NOW }),
      sellChf: 300,
      desiredLane: "STANDARD",
      feedLastSyncAt: null,
      now: NOW,
    });
    expect(r.status).toBe("stale_data");
    expect(r.detail).toContain("never synced");
  });

  it("no usable price (lane + base null) → stale_data", () => {
    const r = evaluatePrecheck({
      variant: variant({ standardBuyPrice: null, expressBuyPrice: null, price: null }),
      sellChf: 300,
      desiredLane: "STANDARD",
      now: NOW,
    });
    expect(r.status).toBe("stale_data");
    expect(r.detail).toContain("no usable price");
  });

  it("excludes non-website brands (BAPE / Essentials / Crocs)", () => {
    expect(isStockxAutoBuyExcluded({ title: "Fear of God Essentials Fleece Hoodie" }).excluded).toBe(
      true
    );
    expect(isStockxAutoBuyExcluded({ title: "BAPE Shark Full Zip Hoodie" }).excluded).toBe(true);
    expect(isStockxAutoBuyExcluded({ title: "Crocs Classic Clog Black" }).excluded).toBe(true);
    expect(isStockxAutoBuyExcluded({ title: "Nike Dunk Low Panda" }).excluded).toBe(false);
  });

  it("sellChf 0 → cannot make margin → too_expensive", () => {
    const r = evaluatePrecheck({
      variant: variant({ standardBuyPrice: 200 }),
      sellChf: 0,
      desiredLane: "STANDARD",
      now: NOW,
    });
    expect(r.status).toBe("too_expensive");
    expect(r.marginPct).toBeNull();
  });
});
