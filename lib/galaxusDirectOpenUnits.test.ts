import { describe, expect, it } from "vitest";
import { decideFulfillUnitSelection } from "@/lib/shopifyFulfillUnitSelection";

describe("galaxus direct GTIN popup decision", () => {
  it("single product qty1 → no popup (auto ship)", () => {
    const d = decideFulfillUnitSelection([
      {
        lineItemId: "a",
        title: "Monopoly Deal",
        variantTitle: null,
        sku: "5010996237002",
        remainingQuantity: 1,
        isScannedLine: true,
      },
    ]);
    expect(d.requiresPopup).toBe(false);
    expect(d.reason).toBe("single_unit");
  });

  it("same line qty2 → popup", () => {
    const d = decideFulfillUnitSelection([
      {
        lineItemId: "a",
        title: "Pair",
        variantTitle: "EU 42",
        sku: null,
        remainingQuantity: 2,
        isScannedLine: true,
      },
    ]);
    expect(d.requiresPopup).toBe(true);
    expect(d.reason).toBe("multi_qty");
  });

  it("two lines → popup", () => {
    const d = decideFulfillUnitSelection([
      {
        lineItemId: "a",
        title: "A",
        variantTitle: null,
        sku: null,
        remainingQuantity: 1,
        isScannedLine: true,
      },
      {
        lineItemId: "b",
        title: "B",
        variantTitle: null,
        sku: null,
        remainingQuantity: 1,
        isScannedLine: false,
      },
    ]);
    expect(d.requiresPopup).toBe(true);
    expect(d.reason).toBe("multi_line");
  });
});
