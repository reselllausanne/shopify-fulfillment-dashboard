import { describe, expect, it } from "vitest";
import { resolveOrderMatchCost } from "@/app/utils/matching";

describe("resolveOrderMatchCost", () => {
  it("forces ESSENTIAL_STOCK / ESS-* to full margin (cost 0) even if DB has old COGS", () => {
    expect(
      resolveOrderMatchCost({
        stockxStatus: "ESSENTIAL_STOCK",
        stockxOrderNumber: "ESS-6573",
        supplierCost: 26,
      })
    ).toEqual({ cost: 0, fullMargin: true });
  });

  it("treats LOCAL ALREADY_EXPENSED (cost 0) as full margin", () => {
    expect(
      resolveOrderMatchCost({
        supplierSource: "LOCAL",
        stockxStatus: "LOCAL_STOCK",
        stockxOrderNumber: "LOCAL-abc",
        supplierCost: 0,
        manualCostOverride: 0,
      })
    ).toEqual({ cost: 0, fullMargin: true });
  });

  it("keeps LOCAL ACQUISITION unit cost", () => {
    expect(
      resolveOrderMatchCost({
        supplierSource: "LOCAL",
        stockxStatus: "LOCAL_STOCK",
        supplierCost: 80,
      })
    ).toEqual({ cost: 80, fullMargin: false });
  });

  it("respects explicit manualCostOverride 0 without falling through to supplierCost", () => {
    expect(
      resolveOrderMatchCost({
        supplierSource: "STOCKX",
        stockxOrderNumber: "03-ABC",
        manualCostOverride: 0,
        supplierCost: 120,
      })
    ).toEqual({ cost: 0, fullMargin: true });
  });

  it("uses StockX supplier cost when no override", () => {
    expect(
      resolveOrderMatchCost({
        supplierSource: "STOCKX",
        stockxOrderNumber: "03-ABC",
        supplierCost: 124.31,
      })
    ).toEqual({ cost: 124.31, fullMargin: false });
  });
});
