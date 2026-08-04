import { describe, expect, it } from "vitest";
import {
  formatGalaxusStockMoqFields,
  meetsGalaxusStockMoq,
  resolveGalaxusStockMoq,
} from "@/galaxus/exports/stockMoq";

describe("resolveGalaxusStockMoq", () => {
  it("defaults to 1/1 for STX and unknown suppliers", () => {
    expect(resolveGalaxusStockMoq({ supplierVariantId: "stx_abc:1" })).toEqual({
      minimumOrderQuantity: 1,
      orderQuantitySteps: 1,
    });
    expect(resolveGalaxusStockMoq({ supplierKey: "ner" })).toEqual({
      minimumOrderQuantity: 1,
      orderQuantitySteps: 1,
    });
    expect(resolveGalaxusStockMoq({})).toEqual({
      minimumOrderQuantity: 1,
      orderQuantitySteps: 1,
    });
  });

  it("applies MOQ 5 for Golden / GLD", () => {
    expect(resolveGalaxusStockMoq({ supplierKey: "golden" })).toEqual({
      minimumOrderQuantity: 5,
      orderQuantitySteps: 1,
    });
    expect(resolveGalaxusStockMoq({ supplierVariantId: "golden:15456" })).toEqual({
      minimumOrderQuantity: 5,
      orderQuantitySteps: 1,
    });
    expect(resolveGalaxusStockMoq({ providerKey: "GLD_4067907638404" })).toEqual({
      minimumOrderQuantity: 5,
      orderQuantitySteps: 1,
    });
    expect(resolveGalaxusStockMoq({ supplierKey: "gld" })).toEqual({
      minimumOrderQuantity: 5,
      orderQuantitySteps: 1,
    });
  });

  it("formats CSV fields and clamps invalid OQS", () => {
    expect(formatGalaxusStockMoqFields({ minimumOrderQuantity: 5, orderQuantitySteps: 1 })).toEqual({
      MinimumOrderQuantity: "5",
      OrderQuantitySteps: "1",
    });
    expect(formatGalaxusStockMoqFields({ minimumOrderQuantity: 5, orderQuantitySteps: 10 })).toEqual({
      MinimumOrderQuantity: "5",
      OrderQuantitySteps: "5",
    });
  });

  it("filters stock below MOQ", () => {
    const gld = { minimumOrderQuantity: 5, orderQuantitySteps: 1 };
    expect(meetsGalaxusStockMoq(5, gld)).toBe(true);
    expect(meetsGalaxusStockMoq(4, gld)).toBe(false);
    expect(meetsGalaxusStockMoq(1, gld)).toBe(false);
    expect(meetsGalaxusStockMoq(0, gld)).toBe(false);
    expect(meetsGalaxusStockMoq(1, { minimumOrderQuantity: 1, orderQuantitySteps: 1 })).toBe(true);
  });
});

