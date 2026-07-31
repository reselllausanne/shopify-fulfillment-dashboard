import { describe, expect, it } from "vitest";
import { buildBucketsFromNeeds } from "@/galaxus/stx/purchaseUnits";

describe("buildBucketsFromNeeds", () => {
  it("counts linked units by GTIN when supplierVariantId changed after price sync", () => {
    const buckets = buildBucketsFromNeeds(
      [{ gtin: "197596162080", supplierVariantId: "stx_new_price", needed: 1 }],
      [
        {
          gtin: "197596162080",
          supplierVariantId: "stx_old_price",
          stockxOrderId: "buy-123",
          etaMin: null,
          etaMax: null,
          awb: null,
        },
      ]
    );
    expect(buckets[0]?.linked).toBe(1);
  });
});
