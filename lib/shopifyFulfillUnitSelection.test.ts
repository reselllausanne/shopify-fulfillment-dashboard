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

  /**
   * Staging-shaped order:
   * - Line A: same pair ×2 (Jordan 1 EU42)
   * - Line B: unrelated model ×1 (New Balance 550)
   * Scan of one unit must NOT ship the whole order.
   */
  it("same pair qty2 + unrelated third pair → popup, select 1 only", () => {
    const open = [
      {
        lineItemId: "gid://shopify/LineItem/jordan-42",
        title: "Jordan 1 Retro High OG",
        variantTitle: "EU 42",
        sku: "555088-001-42",
        remainingQuantity: 2,
        isScannedLine: true,
      },
      {
        lineItemId: "gid://shopify/LineItem/nb-550",
        title: "New Balance 550",
        variantTitle: "EU 43",
        sku: "BB550NCA-43",
        remainingQuantity: 1,
      },
    ];

    const decision = decideFulfillUnitSelection(open);
    expect(decision.requiresPopup).toBe(true);
    expect(decision.reason).toBe("multi_line");
    expect(decision.totalOpenUnits).toBe(3); // 2× Jordan + 1× NB
    expect(decision.openLineCount).toBe(2);

    // Operator ships THIS parcel only: 1× scanned Jordan — never full remaining.
    const oneJordan = validateFulfillUnitSelection(open, [
      { lineItemId: "gid://shopify/LineItem/jordan-42", quantity: 1 },
    ]);
    expect(oneJordan.ok).toBe(true);

    // Implicit full-fulfill of remaining (2 Jordan + 1 NB) must be rejected if over.
    const tooManyJordan = validateFulfillUnitSelection(open, [
      { lineItemId: "gid://shopify/LineItem/jordan-42", quantity: 3 },
    ]);
    expect(tooManyJordan.ok).toBe(false);

    // Selecting both models in one scan is allowed only if operator explicitly picks them —
    // but empty selection (would full-fulfill) is rejected.
    expect(validateFulfillUnitSelection(open, []).ok).toBe(false);

    // Explicit pick of 1 Jordan + 1 NB (2 units of 3) OK when intentional.
    const mixed = validateFulfillUnitSelection(open, [
      { lineItemId: "gid://shopify/LineItem/jordan-42", quantity: 1 },
      { lineItemId: "gid://shopify/LineItem/nb-550", quantity: 1 },
    ]);
    expect(mixed.ok).toBe(true);
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
