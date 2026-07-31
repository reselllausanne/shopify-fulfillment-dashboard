import { describe, expect, it } from "vitest";
import { filterGalaxusLinesNeedingStockxAutoLink } from "@/galaxus/orders/autoLinkStockxBuys";

describe("filterGalaxusLinesNeedingStockxAutoLink", () => {
  it("skips lines that already have a StockX order number on the match row", () => {
    const lines = [
      { id: "line-1", providerKey: "STX_NIKE", gtin: "123" },
      { id: "line-2", providerKey: "STX_ADIDAS", gtin: "456" },
    ];
    const matchByLineId = new Map([
      ["line-1", { stockxOrderNumber: "06-12345-67890" }],
      ["line-2", { stockxOrderNumber: "" }],
    ]);

    const result = filterGalaxusLinesNeedingStockxAutoLink(lines, matchByLineId);
    expect(result.map((line) => line.id)).toEqual(["line-2"]);
  });

  it("skips warehouse-stock lines and non-STX supplier lines", () => {
    const lines = [
      { id: "line-stx", providerKey: "STX_NIKE", gtin: "123" },
      { id: "line-wh", providerKey: "STX_NIKE", gtin: "123", supplierSku: "NER_123" },
      { id: "line-other", providerKey: "DECATHLON", gtin: "789" },
    ];

    const result = filterGalaxusLinesNeedingStockxAutoLink(lines, new Map());
    expect(result.map((line) => line.id)).toEqual(["line-stx"]);
  });
});
