import { describe, expect, it } from "vitest";
import {
  buildBuySourceOverrideStockUpdates,
  listGalaxusBuySourceOverrides,
  resolveGalaxusBuySourceOverride,
} from "@/galaxus/warehouse/buySourceOverride";

describe("resolveGalaxusBuySourceOverride", () => {
  it("maps AF1 White STX keys to golden variants", () => {
    const o = resolveGalaxusBuySourceOverride({ providerKey: "STX_0194500874923" });
    expect(o?.hint).toBe("GOLDEN");
    expect(o?.buySupplierVariantId).toBe("golden:926");
    expect(o?.buyPriceChfFallback).toBe(69.5);
  });

  it("maps by GTIN including stripped leading zero", () => {
    expect(resolveGalaxusBuySourceOverride({ gtin: "0194500874978" })?.buySupplierVariantId).toBe(
      "golden:921"
    );
    expect(resolveGalaxusBuySourceOverride({ gtin: "194500874978" })?.buySupplierVariantId).toBe(
      "golden:921"
    );
  });

  it("returns null for normal STX", () => {
    expect(resolveGalaxusBuySourceOverride({ providerKey: "STX_194500874848" })).toBeNull();
  });

  it("lists all overrides", () => {
    expect(listGalaxusBuySourceOverrides()).toHaveLength(4);
  });

  it("maps live Golden stock to locked listing quantities only", () => {
    const updates = buildBuySourceOverrideStockUpdates(
      new Map([
        ["golden:926", 127],
        ["golden:924", 0],
        ["golden:922", 14.9],
      ])
    );

    expect(updates).toEqual([
      { listingSupplierVariantId: "stx_af1w_0194500874923", manualStock: 127 },
      { listingSupplierVariantId: "stx_eb667426-c617-4b12-950b-fbbe52c14538", manualStock: 0 },
      { listingSupplierVariantId: "stx_134d6624-4683-4733-b836-2424eceef480", manualStock: 14 },
    ]);
  });
});
