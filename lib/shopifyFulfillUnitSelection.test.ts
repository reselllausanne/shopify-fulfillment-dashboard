import { describe, expect, it } from "vitest";
import {
  decideFulfillUnitSelection,
  fulfillScanIdempotencyKey,
  validateFulfillUnitSelection,
} from "@/lib/shopifyFulfillUnitSelection";

describe("shopifyFulfillUnitSelection", () => {
  it("single pair → no popup", () => {
    const d = decideFulfillUnitSelection([
      {
        lineItemId: "L1",
        title: "Shoe",
        variantTitle: "42",
        sku: "A",
        remainingQuantity: 1,
        isScannedLine: true,
      },
    ]);
    expect(d.requiresPopup).toBe(false);
    expect(d.reason).toBe("single_unit");
  });

  it("two different pairs → popup", () => {
    const d = decideFulfillUnitSelection([
      {
        lineItemId: "L1",
        title: "A",
        variantTitle: null,
        sku: "A",
        remainingQuantity: 1,
        isScannedLine: true,
      },
      {
        lineItemId: "L2",
        title: "B",
        variantTitle: null,
        sku: "B",
        remainingQuantity: 1,
      },
    ]);
    expect(d.requiresPopup).toBe(true);
    expect(d.reason).toBe("multi_line");
  });

  it("same pair qty 2 → popup", () => {
    const d = decideFulfillUnitSelection([
      {
        lineItemId: "L1",
        title: "A",
        variantTitle: null,
        sku: "A",
        remainingQuantity: 2,
        isScannedLine: true,
      },
    ]);
    expect(d.requiresPopup).toBe(true);
    expect(d.reason).toBe("multi_qty");
  });

  it("validates partial selection and rejects over-qty", () => {
    const open = [
      {
        lineItemId: "L1",
        title: "A",
        variantTitle: null,
        sku: "A",
        remainingQuantity: 2,
      },
    ];
    expect(validateFulfillUnitSelection(open, [{ lineItemId: "L1", quantity: 1 }]).ok).toBe(
      true
    );
    expect(validateFulfillUnitSelection(open, [{ lineItemId: "L1", quantity: 3 }]).ok).toBe(
      false
    );
  });

  it("stable idempotency key for rescan", () => {
    const a = fulfillScanIdempotencyKey({
      awb: "1ZAAA",
      shopifyOrderId: "oid",
      lineItemId: "lid",
      quantity: 1,
    });
    const b = fulfillScanIdempotencyKey({
      awb: "1zaaa",
      shopifyOrderId: "oid",
      lineItemId: "lid",
      quantity: 1,
    });
    expect(a).toBe(b);
  });
});
