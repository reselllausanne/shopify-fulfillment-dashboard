import { describe, expect, it } from "vitest";
import {
  CUSTOMER_MILESTONE_KEYS_KEEP,
  isCancelRebuyLink,
  STOCKX_PROGRESSION_MILESTONE_KEYS,
} from "@/lib/stockxDelayRebuy/resetMilestonesForCancelRebuy";

describe("isCancelRebuyLink", () => {
  it("detects cancel → new StockX number", () => {
    expect(
      isCancelRebuyLink({
        previousStockxOrderNumber: "03-OLD",
        previousStockxStatus: "CANCELLED",
        newStockxOrderNumber: "03-NEW",
      })
    ).toBe(true);
  });

  it("detects refund → new StockX number", () => {
    expect(
      isCancelRebuyLink({
        previousStockxOrderNumber: "03-OLD",
        previousStockxStatus: "Order Refunded",
        newStockxOrderNumber: "03-NEW",
      })
    ).toBe(true);
  });

  it("rejects same number / live status / missing", () => {
    expect(
      isCancelRebuyLink({
        previousStockxOrderNumber: "03-OLD",
        previousStockxStatus: "CANCELLED",
        newStockxOrderNumber: "03-OLD",
      })
    ).toBe(false);
    expect(
      isCancelRebuyLink({
        previousStockxOrderNumber: "03-OLD",
        previousStockxStatus: "ORDER_CREATED",
        newStockxOrderNumber: "03-NEW",
      })
    ).toBe(false);
    expect(
      isCancelRebuyLink({
        previousStockxOrderNumber: null,
        previousStockxStatus: "CANCELLED",
        newStockxOrderNumber: "03-NEW",
      })
    ).toBe(false);
  });
});

describe("milestone key sets", () => {
  it("keeps customer keys out of progression wipe list", () => {
    for (const key of CUSTOMER_MILESTONE_KEYS_KEEP) {
      expect(STOCKX_PROGRESSION_MILESTONE_KEYS).not.toContain(key);
    }
    expect(STOCKX_PROGRESSION_MILESTONE_KEYS).toContain("DELIVERED_TO_SWISS_DISTRIBUTOR");
    expect(STOCKX_PROGRESSION_MILESTONE_KEYS).toContain("PURCHASE_CONFIRMED");
  });
});
