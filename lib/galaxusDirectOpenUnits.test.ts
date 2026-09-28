import { describe, expect, it } from "vitest";
import { decideFulfillUnitSelection } from "@/lib/shopifyFulfillUnitSelection";
import type { GalaxusDirectOpenUnit } from "@/lib/galaxusDirectOpenUnits";

function unit(
  overrides: Partial<GalaxusDirectOpenUnit> & Pick<GalaxusDirectOpenUnit, "lineId" | "remainingQuantity">
): GalaxusDirectOpenUnit {
  return {
    lineItemId: overrides.lineId,
    title: overrides.title ?? "Pair",
    variantTitle: overrides.variantTitle ?? "EU 42",
    sku: overrides.sku ?? null,
    isScannedLine: overrides.isScannedLine,
    size: overrides.size ?? "EU 42",
    gtin: overrides.gtin ?? null,
    ...overrides,
  };
}

describe("galaxus direct open units → unit selection", () => {
  it("single pair qty1 → no popup", () => {
    const d = decideFulfillUnitSelection([
      unit({ lineId: "a", remainingQuantity: 1, isScannedLine: true }),
    ]);
    expect(d).toMatchObject({ requiresPopup: false, reason: "single_unit" });
  });

  it("same pair qty2 → popup multi_qty", () => {
    const d = decideFulfillUnitSelection([
      unit({ lineId: "a", remainingQuantity: 2, isScannedLine: true }),
    ]);
    expect(d).toMatchObject({ requiresPopup: true, reason: "multi_qty", totalOpenUnits: 2 });
  });

  it("two different pairs on same order → popup multi_line", () => {
    const d = decideFulfillUnitSelection([
      unit({
        lineId: "freak",
        remainingQuantity: 2,
        title: "Zoom Freak 6",
        isScannedLine: true,
      }),
      unit({
        lineId: "top",
        remainingQuantity: 1,
        title: "PEACEMINUSONE Top",
        isScannedLine: false,
      }),
    ]);
    expect(d).toMatchObject({
      requiresPopup: true,
      reason: "multi_line",
      openLineCount: 2,
      totalOpenUnits: 3,
    });
  });
});
