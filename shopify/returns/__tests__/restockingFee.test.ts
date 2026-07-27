import { describe, expect, it } from "vitest";
import { computeReturnRestockingFeeTotal } from "@/shopify/returns/restockingFee";

describe("computeReturnRestockingFeeTotal", () => {
  it("uses Shopify line restocking fee amount when present", () => {
    const result = computeReturnRestockingFeeTotal({
      grossAmount: 189,
      lineItems: [{ restockingFeeAmount: 18.9, quantity: 1 }],
    });
    expect(result).toEqual({
      restockingFeeTotal: 18.9,
      netAmount: 170.1,
      appliedDefaultPercent: false,
    });
  });

  it("applies default 10% when no line fee is configured", () => {
    const result = computeReturnRestockingFeeTotal({
      grossAmount: 189,
      lineItems: [{ unitAmount: 189, quantity: 1, sku: "1167431-DCT-38" }],
    });
    expect(result).toEqual({
      restockingFeeTotal: 18.9,
      netAmount: 170.1,
      appliedDefaultPercent: true,
    });
  });

  it("prefers configured Shopify fee over default percent", () => {
    const result = computeReturnRestockingFeeTotal({
      grossAmount: 200,
      lineItems: [{ restockingFeePercent: 10, unitAmount: 200, quantity: 1 }],
    });
    expect(result.appliedDefaultPercent).toBe(false);
    expect(result.restockingFeeTotal).toBe(20);
    expect(result.netAmount).toBe(180);
  });
});
