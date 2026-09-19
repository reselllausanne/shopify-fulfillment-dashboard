import { describe, expect, it } from "vitest";
import { decideHawPublishedQtyFromPage, parseHawStkAnLager } from "./hawQty";

describe("parseHawStkAnLager", () => {
  it("reads Lagerbestand and Stück an Lager", () => {
    expect(parseHawStkAnLager("Lagerbestand: 3")).toEqual({ qty: 3, label: "Lagerbestand: 3" });
    expect(parseHawStkAnLager("Stück an Lager: 12").qty).toBe(12);
    expect(parseHawStkAnLager("Nichts").qty).toBeNull();
  });
});

describe("decideHawPublishedQtyFromPage", () => {
  it("in stock N=3 → halfCeil(3)=2", () => {
    const d = decideHawPublishedQtyFromPage({
      htmlOrText: "Lagerbestand: 3",
      availability: "https://schema.org/InStock",
    });
    expect(d.sourceQty).toBe(3);
    expect(d.proposedQty).toBe(2);
    expect(d.hasPositiveProof).toBe(true);
  });

  it("N=1 → 1", () => {
    const d = decideHawPublishedQtyFromPage({
      htmlOrText: "Stück an Lager: 1",
      availability: "https://schema.org/InStock",
    });
    expect(d.proposedQty).toBe(1);
  });

  it("OutOfStock → 0", () => {
    const d = decideHawPublishedQtyFromPage({
      htmlOrText: "Lagerbestand: 5",
      availability: "https://schema.org/OutOfStock",
    });
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("schema_out_of_stock");
  });

  it("external stock label → 0, no default 5", () => {
    const d = decideHawPublishedQtyFromPage({
      htmlOrText: "Nicht am Lager. Beim Lieferanten verfügbar.",
      availability: "https://schema.org/InStock",
    });
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("external_stock_no_local_proof");
  });

  it("no qty on page → 0, never default 5", () => {
    const d = decideHawPublishedQtyFromPage({
      htmlOrText: "IN DEN WARENKORB",
      availability: "https://schema.org/InStock",
    });
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("no_qty_on_page");
    expect(d.sourceQty).toBeNull();
  });

  it("zero qty → 0", () => {
    const d = decideHawPublishedQtyFromPage({
      htmlOrText: "Lagerbestand: 0",
      availability: "https://schema.org/InStock",
    });
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("zero_qty");
  });
});
