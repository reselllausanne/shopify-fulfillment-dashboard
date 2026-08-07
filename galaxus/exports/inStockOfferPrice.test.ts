import { describe, expect, it } from "vitest";
import { resolveGalaxusInStockOfferPrice } from "@/galaxus/exports/inStockOfferPrice";

describe("resolveGalaxusInStockOfferPrice", () => {
  it("physical stock: push shelf sell as-is (no VAT strip)", () => {
    expect(
      resolveGalaxusInStockOfferPrice({
        hasPhysicalStock: true,
        manualLock: true,
        manualPrice: 79,
      })
    ).toBe(79);
  });

  it("physical stock keeps shelf even if lock briefly false", () => {
    expect(
      resolveGalaxusInStockOfferPrice({
        hasPhysicalStock: true,
        manualLock: false,
        manualPrice: 79,
      })
    ).toBe(79);
  });

  it("manualLock alone (no mirror yet) still uses shelf", () => {
    expect(
      resolveGalaxusInStockOfferPrice({
        hasPhysicalStock: false,
        manualLock: true,
        manualPrice: 59,
      })
    ).toBe(59);
  });

  it("dropship unlocked with no shelf → null (caller uses STX HT)", () => {
    expect(
      resolveGalaxusInStockOfferPrice({
        hasPhysicalStock: false,
        manualLock: false,
        manualPrice: null,
      })
    ).toBeNull();
  });
});
