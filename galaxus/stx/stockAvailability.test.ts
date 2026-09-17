import { describe, expect, it } from "vitest";
import {
  stxAvailabilityFromMapping,
  stxAvailabilityFromSupplierVariant,
} from "./stockAvailability";

describe("stxAvailabilityFromSupplierVariant", () => {
  it("marks OUT_OF_STOCK when DB asks are 0", () => {
    const result = stxAvailabilityFromSupplierVariant({
      supplierVariantId: "stx_abc",
      providerKey: "STX_123",
      stock: 0,
      deliveryType: "standard",
      updatedAt: new Date("2026-09-07T10:25:20.384Z"),
    });
    expect(result?.status).toBe("OUT_OF_STOCK");
    expect(result?.stock).toBe(0);
  });

  it("marks OK when asks cover requested qty", () => {
    const result = stxAvailabilityFromSupplierVariant(
      {
        supplierVariantId: "stx_abc",
        providerKey: "STX_123",
        stock: 3,
        deliveryType: "express_expedited",
      },
      2
    );
    expect(result?.status).toBe("OK");
    expect(result?.stock).toBe(3);
  });

  it("returns null for non-STX supplier rows", () => {
    expect(
      stxAvailabilityFromSupplierVariant({
        supplierVariantId: "ner_1",
        providerKey: "NER_1",
        stock: 5,
      })
    ).toBeNull();
  });
});

describe("stxAvailabilityFromMapping", () => {
  it("reads nested supplierVariant", () => {
    const result = stxAvailabilityFromMapping({
      supplierVariant: {
        supplierVariantId: "stx_544",
        providerKey: "STX_198480403746",
        stock: 0,
        deliveryType: "standard",
      },
    });
    expect(result?.status).toBe("OUT_OF_STOCK");
  });
});
