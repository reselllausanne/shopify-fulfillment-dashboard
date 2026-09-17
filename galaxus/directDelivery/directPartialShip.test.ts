import { describe, expect, it } from "vitest";
import { orderRequiresPartialDirectShip } from "@/galaxus/directDelivery/directPartialShipRules";

describe("orderRequiresPartialDirectShip", () => {
  it("requires partial for multi-line orders", () => {
    expect(orderRequiresPartialDirectShip([{ quantity: 1 }, { quantity: 1 }])).toBe(true);
  });

  it("requires partial for single line qty>1", () => {
    expect(orderRequiresPartialDirectShip([{ quantity: 5 }])).toBe(true);
  });

  it("allows whole-order label for single qty 1", () => {
    expect(orderRequiresPartialDirectShip([{ quantity: 1 }])).toBe(false);
  });
});
