import { describe, expect, it } from "vitest";
import {
  isStxHistoricalCapAffected,
  repairStxCapLaneFromSource,
} from "@/galaxus/stx/repairExpressCapLane";

const product = { slug: "test-product", title: "Test Product" };

describe("isStxHistoricalCapAffected", () => {
  it("flags express ≥ ratio × standard", () => {
    expect(
      isStxHistoricalCapAffected({ expressBuyPrice: 400, standardBuyPrice: 200 }, 2)
    ).toBe(true);
    expect(
      isStxHistoricalCapAffected({ expressBuyPrice: 399, standardBuyPrice: 200 }, 2)
    ).toBe(false);
  });

  it("requires both buys > 0", () => {
    expect(
      isStxHistoricalCapAffected({ expressBuyPrice: 400, standardBuyPrice: null }, 2)
    ).toBe(false);
    expect(
      isStxHistoricalCapAffected({ expressBuyPrice: 0, standardBuyPrice: 200 }, 2)
    ).toBe(false);
  });
});

describe("repairStxCapLaneFromSource", () => {
  it("standard+stock0, Express asks>0, Standard asks=0 → repaired_standard_to_express with stock", () => {
    const decision = repairStxCapLaneFromSource({
      current: {
        supplierVariantId: "stx_v1",
        deliveryType: "standard",
        stock: 0,
        price: 200,
        expressBuyPrice: 900,
        standardBuyPrice: 200,
      },
      sourcePrices: [
        { type: "express_standard", price: 900, asks: 5 },
        { type: "standard", price: 200, asks: 0 },
      ],
      productPayload: product,
      productName: "Test Product",
    });
    expect(decision.bucket).toBe("repaired_standard_to_express");
    expect(decision.next).not.toBeNull();
    expect(decision.next!.deliveryType).toMatch(/^express/);
    expect(decision.next!.stock).toBe(5);
    expect(decision.sourceExpressAsks).toBe(5);
    expect(decision.sourceStandardAsks).toBe(0);
  });

  it("standard+stock0, Standard asks>0 → repaired_stock_restored_standard", () => {
    const decision = repairStxCapLaneFromSource({
      current: {
        supplierVariantId: "stx_v2",
        deliveryType: "standard",
        stock: 0,
        price: 175,
        expressBuyPrice: 932,
        standardBuyPrice: 175,
      },
      sourcePrices: [
        { type: "express_standard", price: 932, asks: 1 },
        { type: "standard", price: 175, asks: 12 },
      ],
      productPayload: product,
      productName: "Test Product",
    });
    expect(decision.bucket).toBe("repaired_stock_restored_standard");
    expect(decision.next).not.toBeNull();
    expect(decision.next!.deliveryType).toBe("standard");
    expect(decision.next!.stock).toBe(12);
  });

  it("both asks=0 → true_oos_source_asks_zero", () => {
    const decision = repairStxCapLaneFromSource({
      current: {
        supplierVariantId: "stx_v3",
        deliveryType: "standard",
        stock: 0,
        price: 100,
        expressBuyPrice: 300,
        standardBuyPrice: 100,
      },
      sourcePrices: [
        { type: "express_standard", price: 300, asks: 0 },
        { type: "standard", price: 100, asks: 0 },
      ],
      productPayload: product,
      productName: "Test Product",
    });
    expect(decision.bucket).toBe("true_oos_source_asks_zero");
    expect(decision.next).toBeNull();
  });

  it("source null → missing_source (NOT true OOS)", () => {
    const decision = repairStxCapLaneFromSource({
      current: {
        supplierVariantId: "stx_v4",
        deliveryType: "standard",
        stock: 0,
        price: 100,
        expressBuyPrice: 300,
        standardBuyPrice: 100,
      },
      sourcePrices: null,
      productPayload: product,
      productName: "Test Product",
    });
    expect(decision.bucket).toBe("missing_source");
    expect(decision.bucket).not.toBe("true_oos_source_asks_zero");
    expect(decision.next).toBeNull();
  });
});
