import { describe, expect, it } from "vitest";
import { buildBucketsFromNeeds, expandGtinsForDbLookup } from "@/galaxus/stx/purchaseUnits";

describe("expandGtinsForDbLookup", () => {
  it("includes UPC-12 padding used in VariantMapping", () => {
    const expanded = expandGtinsForDbLookup(["19649508150"]);
    expect(expanded).toContain("19649508150");
    expect(expanded).toContain("019649508150");
    expect(expanded).toContain("0019649508150");
  });
});

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
