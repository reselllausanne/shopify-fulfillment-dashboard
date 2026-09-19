import { describe, expect, it } from "vitest";
import { decideWrkPublishedQty, parseWrkStock } from "./wrkQty";

describe("wrkQty", () => {
  it("tracked N=4 → halfCeil→2", () => {
    const d = decideWrkPublishedQty(
      parseWrkStock({ available: true, trackedQty: 4, inventoryManagement: "shopify" })
    );
    expect(d.sourceQty).toBe(4);
    expect(d.proposedQty).toBe(2);
  });

  it("tracked N=1 → 1", () => {
    const d = decideWrkPublishedQty(
      parseWrkStock({ available: true, trackedQty: 1, inventoryManagement: "shopify" })
    );
    expect(d.proposedQty).toBe(1);
  });

  it("tracked zero → 0", () => {
    const d = decideWrkPublishedQty(
      parseWrkStock({ available: true, trackedQty: 0, inventoryManagement: "shopify" })
    );
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("tracked_zero_or_missing");
  });

  it("untracked available → 1 quantityUnknown", () => {
    const d = decideWrkPublishedQty(
      parseWrkStock({ available: true, trackedQty: null, inventoryManagement: null })
    );
    expect(d.proposedQty).toBe(1);
    expect(d.quantityUnknown).toBe(true);
  });

  it("not available → 0", () => {
    const d = decideWrkPublishedQty(parseWrkStock({ available: false }));
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("not_available");
  });

  it("preorder → 0", () => {
    const d = decideWrkPublishedQty(parseWrkStock({ available: true, isPreorder: true }));
    expect(d.proposedQty).toBe(0);
  });

  it("page missing → 0 never invent hidden qty", () => {
    const d = decideWrkPublishedQty(parseWrkStock({ pageMissing: true }));
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("page_missing");
  });

  it("late delivery → 0", () => {
    const d = decideWrkPublishedQty(parseWrkStock({ available: true, lateDelivery: true }));
    expect(d.proposedQty).toBe(0);
  });
});
