import { describe, expect, it } from "vitest";
import { decideWrkPublishedQty } from "./wrkQty";

describe("wrkQty", () => {
  it("tracked N=4 → halfCeil→2", () => {
    const d = decideWrkPublishedQty({
      pagePresent: true,
      available: true,
      trackedQty: 4,
      inventoryTracked: true,
    });
    expect(d.sourceQty).toBe(4);
    expect(d.proposedQty).toBe(2);
  });
  it("N=1 → 1", () => {
    expect(
      decideWrkPublishedQty({
        pagePresent: true,
        available: true,
        trackedQty: 1,
        inventoryTracked: true,
      }).proposedQty
    ).toBe(1);
  });
  it("hidden untracked → 0 qty_hidden_not_invented", () => {
    const d = decideWrkPublishedQty({
      pagePresent: true,
      available: true,
      trackedQty: null,
      inventoryTracked: false,
    });
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("qty_hidden_not_invented");
  });
  it("!available → 0", () => {
    expect(decideWrkPublishedQty({ pagePresent: true, available: false }).proposedQty).toBe(0);
  });
  it("page missing → 0", () => {
    expect(decideWrkPublishedQty({ pagePresent: false }).proposedQty).toBe(0);
  });
  it("preorder → 0", () => {
    expect(
      decideWrkPublishedQty({
        pagePresent: true,
        available: true,
        isPreorder: true,
      }).proposedQty
    ).toBe(0);
  });
  it("late delivery → 0", () => {
    expect(
      decideWrkPublishedQty({
        pagePresent: true,
        available: true,
        lateDelivery: true,
      }).proposedQty
    ).toBe(0);
  });
  it("tracked zero → 0", () => {
    expect(
      decideWrkPublishedQty({
        pagePresent: true,
        available: true,
        trackedQty: 0,
        inventoryTracked: true,
      }).proposedQty
    ).toBe(0);
  });
});
