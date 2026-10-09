import { describe, expect, it } from "vitest";
import { resolveOrderMatchCost } from "@/app/utils/matching";

describe("resolveOrderMatchCost", () => {
  it("uses fixed per-unit cost for ESS-* rows even when DB stored 0", () => {
    expect(
      resolveOrderMatchCost({
        shopifyProductTitle: "Essentials Shorts Stretch Limo (SS22)",
        stockxStatus: "ESSENTIAL_STOCK",
        stockxOrderNumber: "ESS-6573",
        supplierCost: 0,
      })
    ).toEqual({ cost: 26, fullMargin: false });
  });

  it("keeps manualCostOverride on ESS-* rows", () => {
    expect(
      resolveOrderMatchCost({
        shopifyProductTitle: "Essentials Shorts Stretch Limo (SS22)",
        stockxOrderNumber: "ESS-6573",
        supplierCost: 0,
        manualCostOverride: 10,
      })
    ).toEqual({ cost: 10, fullMargin: false });
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
