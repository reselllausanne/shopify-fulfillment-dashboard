import { describe, expect, it } from "vitest";
import { buildTusObservationId, decideTusPublishedQty, parseTusStock } from "./tusQty";

describe("buildTusObservationId", () => {
  it("distinguishes parent vs variant", () => {
    expect(buildTusObservationId({ parentWooId: 10, variantWooId: 20, gtin: "1" })).toBe(
      "tus_p10_v20_1"
    );
    expect(buildTusObservationId({ parentWooId: null, variantWooId: 30, gtin: "2" })).toBe(
      "tus_p0_v30_2"
    );
  });
});

describe("tusQty", () => {
  it("Verfügbar: 3 → halfCeil→2", () => {
    const d = decideTusPublishedQty(
      parseTusStock({ stockText: "Verfügbar: 3", isPurchasable: true, isInStock: true })
    );
    expect(d.sourceQty).toBe(3);
    expect(d.proposedQty).toBe(2);
  });

  it("N=1 vorrätig → 1", () => {
    const d = decideTusPublishedQty(
      parseTusStock({ stockText: "1 vorrätig", isPurchasable: true, isInStock: true })
    );
    expect(d.proposedQty).toBe(1);
  });

  it("Nicht vorrätig → 0", () => {
    const d = decideTusPublishedQty(
      parseTusStock({ stockText: "Nicht vorrätig", isPurchasable: false, isInStock: false })
    );
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("not_purchasable");
  });

  it("preorder → 0", () => {
    const d = decideTusPublishedQty(
      parseTusStock({ stockText: "Verfügbar: 5", isPreorder: true, isPurchasable: true })
    );
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("preorder");
  });

  it("missing qty → 0, never invent", () => {
    const d = decideTusPublishedQty(parseTusStock({ isPurchasable: true, isInStock: true }));
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("no_qty");
    expect(d.sourceQty).toBeNull();
  });

  it("cartMax 9999 rejected", () => {
    const d = decideTusPublishedQty(
      parseTusStock({ cartMax: 9999, isPurchasable: true, isInStock: true })
    );
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("no_qty");
  });

  it("cartMax 4 accepted → halfCeil→2", () => {
    const d = decideTusPublishedQty(
      parseTusStock({ cartMax: 4, isPurchasable: true, isInStock: true })
    );
    expect(d.sourceQty).toBe(4);
    expect(d.proposedQty).toBe(2);
  });
});
