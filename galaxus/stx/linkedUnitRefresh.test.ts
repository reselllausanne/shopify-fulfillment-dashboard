import { describe, expect, it } from "vitest";
import {
  stxUnitEligibleForStoredRefRefresh,
  stxUnitNeedsStockxRefresh,
} from "@/galaxus/stx/linkedUnitRefresh";

describe("stxUnitEligibleForStoredRefRefresh", () => {
  it("accepts stockxOrderId", () => {
    expect(stxUnitEligibleForStoredRefRefresh({ stockxOrderId: "abc-123" })).toBe(true);
  });

  it("accepts real order number without order id", () => {
    expect(
      stxUnitEligibleForStoredRefRefresh({
        stockxOrderId: null,
        stockxOrderNumber: "01-ABC123",
      })
    ).toBe(true);
  });

  it("rejects MANUAL- placeholders", () => {
    expect(
      stxUnitEligibleForStoredRefRefresh({
        stockxOrderId: null,
        stockxOrderNumber: "MANUAL-xyz",
      })
    ).toBe(false);
  });

  it("rejects empty refs", () => {
    expect(stxUnitEligibleForStoredRefRefresh({ stockxOrderId: null, stockxOrderNumber: "" })).toBe(
      false
    );
  });
});

describe("stxUnitNeedsStockxRefresh", () => {
  it("needs refresh when AWB missing", () => {
    expect(
      stxUnitNeedsStockxRefresh({
        awb: null,
        etaMin: new Date(),
        etaMax: new Date(),
        stockxSettledAmount: 10,
        checkoutType: "STANDARD",
      })
    ).toBe(true);
  });

  it("needs refresh when ETA incomplete", () => {
    expect(
      stxUnitNeedsStockxRefresh({
        awb: "99.00.123456.12345678",
        etaMin: new Date(),
        etaMax: null,
        stockxSettledAmount: 10,
        checkoutType: "STANDARD",
      })
    ).toBe(true);
  });

  it("skips when fully populated", () => {
    expect(
      stxUnitNeedsStockxRefresh({
        awb: "99.00.123456.12345678",
        etaMin: new Date(),
        etaMax: new Date(),
        stockxSettledAmount: 120.5,
        checkoutType: "STANDARD",
      })
    ).toBe(false);
  });
});
