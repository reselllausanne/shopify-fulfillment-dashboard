import { describe, expect, it } from "vitest";
import { isShopifyOrderResolved } from "@/lib/stockxDelayRebuy/sweepStaleCancelled";

describe("isShopifyOrderResolved", () => {
  it("open unfulfilled paid order is not resolved", () => {
    expect(isShopifyOrderResolved({ cancelledAt: null, displayFinancialStatus: "PAID", displayFulfillmentStatus: "UNFULFILLED" })).toBe(false);
  });
  it("cancelled / refunded / voided / fulfilled are resolved", () => {
    expect(isShopifyOrderResolved({ cancelledAt: "2026-11-01" })).toBe(true);
    expect(isShopifyOrderResolved({ displayFinancialStatus: "REFUNDED" })).toBe(true);
    expect(isShopifyOrderResolved({ displayFinancialStatus: "PARTIALLY_REFUNDED" })).toBe(true);
    expect(isShopifyOrderResolved({ displayFinancialStatus: "VOIDED" })).toBe(true);
    expect(isShopifyOrderResolved({ displayFulfillmentStatus: "FULFILLED" })).toBe(true);
  });
  it("unknown state (API failed) is unresolved", () => {
    expect(isShopifyOrderResolved(null)).toBe(false);
  });
});
