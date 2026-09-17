import { describe, expect, it } from "vitest";
import { selectStxCatalogDisplayBuyPrice, selectStxWarehouseBuyRef } from "./catalogBuyPrice";

describe("selectStxCatalogDisplayBuyPrice", () => {
  it("prefers active lane price over stale expressBuyPrice", () => {
    const price = selectStxCatalogDisplayBuyPrice({
      supplierVariant: {
        supplierVariantId: "stx_abc",
        providerKey: "STX_4550457029070",
        price: 140.61,
        deliveryType: "standard",
        standardBuyPrice: 140.61,
        expressBuyPrice: 176.02,
      },
    });
    expect(price).toBe(140.61);
  });

  it("picks cheaper standard when both lanes are stored", () => {
    const ref = selectStxWarehouseBuyRef({
      supplierVariant: {
        supplierVariantId: "stx_abc",
        providerKey: "STX_198482394479",
        price: 116.27,
        deliveryType: "express_standard",
        standardBuyPrice: 108.52,
        expressBuyPrice: 116.27,
      },
    });
    expect(ref.price).toBe(108.52);
    expect(ref.lane).toBe("standard");
  });

  it("uses express when it is cheaper than standard", () => {
    const ref = selectStxWarehouseBuyRef({
      supplierVariant: {
        supplierVariantId: "stx_abc",
        providerKey: "STX_1",
        price: 100,
        deliveryType: "express_expedited",
        standardBuyPrice: 120,
        expressBuyPrice: 100,
      },
    });
    expect(ref.price).toBe(100);
    expect(ref.lane).toBe("express");
  });
});
