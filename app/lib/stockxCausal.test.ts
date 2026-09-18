import { describe, expect, it } from "vitest";
import {
  STOCKX_CAUSAL_SKEW_MINUTES,
  isValidStockxBuyAfterCustomerOrder,
  isValidGalaxusStockxCausalBuy,
} from "@/app/lib/stockxCausal";

describe("stockx causal rule (strict, zero skew)", () => {
  it("skew constant is zero", () => {
    expect(STOCKX_CAUSAL_SKEW_MINUTES).toBe(0);
  });

  it("allows StockX buy after customer order", () => {
    expect(
      isValidStockxBuyAfterCustomerOrder(
        "2026-09-10T10:00:00.000Z",
        "2026-09-10T12:00:00.000Z"
      )
    ).toBe(true);
  });

  it("allows exact equality (buy == order)", () => {
    expect(
      isValidStockxBuyAfterCustomerOrder(
        "2026-09-10T12:00:00.000Z",
        "2026-09-10T12:00:00.000Z"
      )
    ).toBe(true);
  });

  it("rejects buy 1ms before order", () => {
    expect(
      isValidStockxBuyAfterCustomerOrder(
        "2026-09-10T12:00:00.000Z",
        "2026-09-10T11:59:59.999Z"
      )
    ).toBe(false);
  });

  it("rejects StockX buy before customer order (no skew allowance)", () => {
    expect(
      isValidStockxBuyAfterCustomerOrder(
        "2026-09-10T12:00:00.000Z",
        "2026-09-10T10:00:00.000Z"
      )
    ).toBe(false);
  });

  it("ignores skewMinutes argument entirely", () => {
    // Explicit 60 minute skew must NOT change strict rule outcome.
    expect(
      isValidStockxBuyAfterCustomerOrder(
        "2026-09-10T12:00:00.000Z",
        "2026-09-10T11:56:00.000Z",
        60
      )
    ).toBe(false);
    expect(
      isValidGalaxusStockxCausalBuy(
        "2026-09-10T12:00:00.000Z",
        "2026-09-10T11:56:00.000Z",
        60
      )
    ).toBe(false);
  });

  it("rejects missing dates", () => {
    expect(
      isValidStockxBuyAfterCustomerOrder(null, "2026-09-10T12:00:00.000Z")
    ).toBe(false);
    expect(
      isValidStockxBuyAfterCustomerOrder("2026-09-10T12:00:00.000Z", null)
    ).toBe(false);
    expect(isValidStockxBuyAfterCustomerOrder(null, null)).toBe(false);
  });
});
