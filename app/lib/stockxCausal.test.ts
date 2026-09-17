import { describe, expect, it } from "vitest";
import {
  isValidStockxBuyAfterCustomerOrder,
  isValidGalaxusStockxCausalBuy,
} from "@/app/lib/stockxCausal";

describe("stockx causal rule", () => {
  it("allows StockX buy after customer order", () => {
    expect(
      isValidStockxBuyAfterCustomerOrder(
        "2026-09-10T10:00:00.000Z",
        "2026-09-10T12:00:00.000Z"
      )
    ).toBe(true);
  });

  it("rejects StockX buy before customer order (beyond skew)", () => {
    expect(
      isValidStockxBuyAfterCustomerOrder(
        "2026-09-10T12:00:00.000Z",
        "2026-09-10T10:00:00.000Z"
      )
    ).toBe(false);
  });

  it("allows buy up to 5 minutes before order (clock skew)", () => {
    expect(
      isValidGalaxusStockxCausalBuy(
        "2026-09-10T12:00:00.000Z",
        "2026-09-10T11:56:00.000Z"
      )
    ).toBe(true);
  });

  it("rejects missing dates", () => {
    expect(isValidStockxBuyAfterCustomerOrder(null, "2026-09-10T12:00:00.000Z")).toBe(
      false
    );
  });
});
