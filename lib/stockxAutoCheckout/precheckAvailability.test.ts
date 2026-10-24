import { describe, expect, it } from "vitest";
import {
  evaluatePrecheck,
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
