import { describe, expect, it } from "vitest";
import {
  applySavedMatchCountsToBuckets,
  buildBucketsFromNeeds,
  expandGtinsForDbLookup,
  shouldWriteGalaxusMatchForLinkResult,
} from "@/galaxus/stx/purchaseUnits";

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

describe("shouldWriteGalaxusMatchForLinkResult", () => {
  it("writes on fresh link", () => {
    expect(shouldWriteGalaxusMatchForLinkResult({ status: "linked" })).toBe(true);
  });

  it("writes on idempotent re-run for same order", () => {
    expect(shouldWriteGalaxusMatchForLinkResult({ status: "already_linked" })).toBe(true);
  });

  it("skips when StockX buy is already claimed by another Galaxus order", () => {
    expect(
      shouldWriteGalaxusMatchForLinkResult({ status: "already_linked_other_order" })
    ).toBe(false);
  });

  it("skips when reservation had no pending unit", () => {
    expect(shouldWriteGalaxusMatchForLinkResult({ status: "no_pending_unit" })).toBe(false);
  });

  it("skips when ETA missing (non-manual paths)", () => {
    expect(shouldWriteGalaxusMatchForLinkResult({ status: "missing_eta" })).toBe(false);
  });
});

describe("applySavedMatchCountsToBuckets", () => {
  it("does not treat one saved match as covering qty 2", () => {
    const buckets = applySavedMatchCountsToBuckets(
      [
        {
          gtin: "19649237609",
          supplierVariantId: "stx_gobs",
          needed: 2,
          reserved: 2,
          linked: 1,
          linkedWithEta: 1,
          linkedWithAwb: 0,
        },
      ],
      [{ galaxusGtin: "19649237609", stockxOrderNumber: "03-9NH6QN4TUH" }]
    );
    expect(buckets[0]?.linked).toBe(1);
  });
});
