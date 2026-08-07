import { describe, expect, it } from "vitest";
import { mergePhysicalWithDropship } from "@/shopify/inventory/physicalAvailability";

describe("mergePhysicalWithDropship", () => {
  it("combines dropship + physical at market price", () => {
    expect(
      mergePhysicalWithDropship({ dropshipStock: 2, physicalQty: 1 })
    ).toEqual({ finalStock: 3, kept: true, source: "combined" });
  });

  it("liquidation lock: physical only — never stack STX asks on soldes price", () => {
    expect(
      mergePhysicalWithDropship({
        dropshipStock: 2,
        physicalQty: 1,
        liquidationLocked: true,
      })
    ).toEqual({ finalStock: 1, kept: true, source: "physical" });
  });

  it("liquidation lock with no physical falls through to dropship", () => {
    expect(
      mergePhysicalWithDropship({
        dropshipStock: 2,
        physicalQty: 0,
        liquidationLocked: true,
      })
    ).toEqual({ finalStock: 2, kept: true, source: "dropship" });
  });

  it("delisted dropship keeps physical", () => {
    expect(
      mergePhysicalWithDropship({
        dropshipStock: 0,
        physicalQty: 1,
        dropshipDelisted: true,
      })
    ).toEqual({ finalStock: 1, kept: true, source: "physical" });
  });
});
