import { describe, expect, it } from "vitest";
import {
  filterGalaxusLinesNeedingStockxAutoLink,
  nextUnlinkedUnitIndex,
} from "@/galaxus/orders/autoLinkStockxBuys";

describe("filterGalaxusLinesNeedingStockxAutoLink", () => {
  it("skips lines that already have a StockX order number on the match row", () => {
    const lines = [
      { id: "line-1", providerKey: "STX_NIKE", gtin: "123" },
      { id: "line-2", providerKey: "STX_ADIDAS", gtin: "456" },
    ];
    const matches = [
      { galaxusOrderLineId: "line-1", stockxOrderNumber: "06-12345-67890" },
      { galaxusOrderLineId: "line-2", stockxOrderNumber: "" },
    ];

    const result = filterGalaxusLinesNeedingStockxAutoLink(lines, matches);
    expect(result.map((line) => line.id)).toEqual(["line-2"]);
  });

  it("keeps qty>1 lines when only some units are linked", () => {
    const lines = [{ id: "line-qty2", providerKey: "STX_NIKE", gtin: "123", quantity: 2 }];
    const matches = [{ galaxusOrderLineId: "line-qty2", stockxOrderNumber: "03-AAAA", unitIndex: 0 }];

    const result = filterGalaxusLinesNeedingStockxAutoLink(lines, matches);
    expect(result.map((line) => line.id)).toEqual(["line-qty2"]);
  });

  it("skips warehouse-stock lines and non-STX supplier lines", () => {
    const lines = [
      { id: "line-stx", providerKey: "STX_NIKE", gtin: "123" },
      { id: "line-wh", providerKey: "STX_NIKE", gtin: "123", supplierSku: "NER_123" },
      { id: "line-other", providerKey: "DECATHLON", gtin: "789" },
    ];

    const result = filterGalaxusLinesNeedingStockxAutoLink(lines, []);
    expect(result.map((line) => line.id)).toEqual(["line-stx"]);
  });
});

describe("nextUnlinkedUnitIndex", () => {
  it("returns unit 1 when unit 0 already has a StockX order", () => {
    const next = nextUnlinkedUnitIndex(
      "line-qty2",
      2,
      [{ galaxusOrderLineId: "line-qty2", unitIndex: 0, stockxOrderNumber: "03-9NH6QN4TUH" }]
    );
    expect(next).toBe(1);
  });
});
