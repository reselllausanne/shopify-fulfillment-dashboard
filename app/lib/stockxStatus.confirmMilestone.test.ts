import { describe, expect, it } from "vitest";
import {
  getPurchaseConfirmedMilestone,
  isPurchaseConfirmedMilestoneKey,
  resolvePurchaseConfirmedMilestone,
} from "@/app/lib/stockxStatus";

describe("purchase confirmed milestone (auto-buy link email)", () => {
  it("STANDARD → PURCHASE_CONFIRMED", () => {
    const m = getPurchaseConfirmedMilestone("STANDARD", "03-ABCDEFGH");
    expect(m.key).toBe("PURCHASE_CONFIRMED");
    expect(isPurchaseConfirmedMilestoneKey(m.key)).toBe(true);
  });

  it("EXPRESS 01- → EXPRESS_CONFIRMED", () => {
    const m = getPurchaseConfirmedMilestone(null, "01-ABCDEFGH");
    expect(m.key).toBe("EXPRESS_CONFIRMED");
  });

  it("empty states + forceSynthetic → synthetic confirm", () => {
    const m = resolvePurchaseConfirmedMilestone({
      checkoutType: "STANDARD",
      orderNumber: "03-XYZ",
      hasStockxStates: false,
      forceSyntheticStates: true,
    });
    expect(m?.key).toBe("PURCHASE_CONFIRMED");
    expect(m?.synthetic).toBe(true);
  });

  it("empty states without force → null", () => {
    const m = resolvePurchaseConfirmedMilestone({
      checkoutType: "STANDARD",
      orderNumber: "03-XYZ",
      hasStockxStates: false,
      forceSyntheticStates: false,
    });
    expect(m).toBeNull();
  });
});
