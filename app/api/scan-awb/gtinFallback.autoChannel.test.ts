import { describe, expect, it } from "vitest";
import {
  decideGtinAutoChannel,
  filterShopifyMatchesByScannedSize,
  sizeKeyForGtinMatch,
} from "./gtinFallback";

describe("filterShopifyMatchesByScannedSize", () => {
  const m405 = { id: "a", shopifySku: "3ME10101430", shopifySizeEU: "EU 40.5" };
  const m43 = { id: "b", shopifySku: "3ME10101430", shopifySizeEU: "43" };
  const other = { id: "c", shopifySku: "DZ5485-612", shopifySizeEU: "EU 42" };

  it("normalizes EU prefix and spacing", () => {
    expect(sizeKeyForGtinMatch("EU 40.5")).toBe("40.5");
    expect(sizeKeyForGtinMatch("40,5")).toBe("40.5");
    expect(sizeKeyForGtinMatch(null)).toBeNull();
  });

  it("keeps only scanned size on shared style SKU", () => {
    const out = filterShopifyMatchesByScannedSize([m405, m43, other], {
      sharedSkus: new Set(["3ME10101430"]),
      scannedSizeKeys: new Set(["40.5"]),
    });
    expect(out.map((r) => [r.id, r.sizeUnverified])).toEqual([
      ["a", false],
      ["c", false],
    ]);
  });

  it("keeps shared SKU rows but flags unverified when scanned size unknown", () => {
    const out = filterShopifyMatchesByScannedSize([m405, m43], {
      sharedSkus: new Set(["3ME10101430"]),
      scannedSizeKeys: new Set(),
    });
    expect(out.every((r) => r.sizeUnverified)).toBe(true);
  });

  it("does not size-filter per-variant SKUs", () => {
    const out = filterShopifyMatchesByScannedSize([other], {
      sharedSkus: new Set(),
      scannedSizeKeys: new Set(["40.5"]),
    });
    expect(out).toEqual([{ ...other, sizeUnverified: false }]);
  });
});

describe("decideGtinAutoChannel", () => {
  it("passes through direct when only direct is open", () => {
    expect(
      decideGtinAutoChannel({
        openDirect: 1,
        openWarehouse: 0,
        autoRowChannel: "galaxus_direct",
      })
    ).toEqual({ autoChannel: "galaxus_direct", requiresChannelChoice: false });
  });

  it("blocks auto when warehouse AND direct both open for same GTIN", () => {
    expect(
      decideGtinAutoChannel({
        openDirect: 1,
        openWarehouse: 1,
        autoRowChannel: "galaxus_direct",
      })
    ).toEqual({ autoChannel: null, requiresChannelChoice: true });
  });

  it("still blocks auto even if shopify would have won", () => {
    expect(
      decideGtinAutoChannel({
        openDirect: 2,
        openWarehouse: 1,
        autoRowChannel: "shopify",
      })
    ).toEqual({ autoChannel: null, requiresChannelChoice: true });
  });

  it("allows shopify when no warehouse conflict", () => {
    expect(
      decideGtinAutoChannel({
        openDirect: 0,
        openWarehouse: 0,
        autoRowChannel: "shopify",
      })
    ).toEqual({ autoChannel: "shopify", requiresChannelChoice: false });
  });

  it("returns null channel when warehouse-only (packing handles it)", () => {
    expect(
      decideGtinAutoChannel({
        openDirect: 0,
        openWarehouse: 2,
        autoRowChannel: null,
      })
    ).toEqual({ autoChannel: null, requiresChannelChoice: false });
  });
});
