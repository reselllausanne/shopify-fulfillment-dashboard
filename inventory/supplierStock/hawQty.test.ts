import { describe, expect, it } from "vitest";
import { decideHawPublishedQty } from "./hawQty";

describe("hawQty", () => {
  it("Lagerbestand 3 → halfCeil→2", () => {
    const d = decideHawPublishedQty({ htmlOrText: "Lagerbestand: 3", inStockSchema: true });
    expect(d.sourceQty).toBe(3);
    expect(d.proposedQty).toBe(2);
    expect(d.hasPositiveProof).toBe(true);
  });
  it("Stück an Lager 1 → 1", () => {
    const d = decideHawPublishedQty({ htmlOrText: "Stück an Lager: 1", inStockSchema: true });
    expect(d.proposedQty).toBe(1);
  });
  it("OutOfStock schema → 0", () => {
    const d = decideHawPublishedQty({ htmlOrText: "Lagerbestand: 5", inStockSchema: false });
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("schema_out_of_stock");
  });
  it("external stock label → 0 (never default 5)", () => {
    const d = decideHawPublishedQty({ htmlOrText: "Beim Lieferanten verfügbar", inStockSchema: true });
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("external_stock_no_local_proof");
  });
  it("missing qty → 0 never default 5", () => {
    const d = decideHawPublishedQty({ htmlOrText: "InStock", inStockSchema: true });
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("no_lagerbestand_qty");
  });
  it("zero qty → 0", () => {
    const d = decideHawPublishedQty({ htmlOrText: "Lagerbestand: 0", inStockSchema: true });
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("zero_qty");
  });
  it("scrape blocked (empty text) → 0", () => {
    const d = decideHawPublishedQty({ htmlOrText: "", inStockSchema: true });
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("no_lagerbestand_qty");
  });
});
