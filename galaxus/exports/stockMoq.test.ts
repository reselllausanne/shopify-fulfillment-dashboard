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

  it("parses moq/oqs from manualNote ahead of supplier defaults", () => {
    expect(
      resolveGalaxusStockMoq({
        supplierKey: "stx",
        manualNote: "mq2-liquidation unit=67 moq=10 oqs=10",
      })
    ).toEqual({ minimumOrderQuantity: 10, orderQuantitySteps: 10 });
    expect(
      resolveGalaxusStockMoq({
        supplierKey: "golden",
        manualNote: "mq2-liquidation unit=67 moq=10",
      })
    ).toEqual({ minimumOrderQuantity: 10, orderQuantitySteps: 10 });
  });

  it("applies MOQ 3 for Golden / GLD", () => {
    expect(resolveGalaxusStockMoq({ supplierKey: "golden" })).toEqual({
      minimumOrderQuantity: 3,
      orderQuantitySteps: 1,
    });
    expect(resolveGalaxusStockMoq({ supplierVariantId: "golden:15456" })).toEqual({
      minimumOrderQuantity: 3,
      orderQuantitySteps: 1,
    });
    expect(resolveGalaxusStockMoq({ providerKey: "GLD_4067907638404" })).toEqual({
      minimumOrderQuantity: 3,
      orderQuantitySteps: 1,
    });
    expect(resolveGalaxusStockMoq({ supplierKey: "gld" })).toEqual({
      minimumOrderQuantity: 3,
      orderQuantitySteps: 1,
    });
  });

  it("formats CSV fields and clamps invalid OQS", () => {
    expect(formatGalaxusStockMoqFields({ minimumOrderQuantity: 3, orderQuantitySteps: 1 })).toEqual({
      MinimumOrderQuantity: "3",
      OrderQuantitySteps: "1",
    });
    expect(formatGalaxusStockMoqFields({ minimumOrderQuantity: 3, orderQuantitySteps: 10 })).toEqual({
      MinimumOrderQuantity: "3",
      OrderQuantitySteps: "3",
    });
  });

  it("filters stock below MOQ", () => {
    const gld = { minimumOrderQuantity: 3, orderQuantitySteps: 1 };
    expect(meetsGalaxusStockMoq(3, gld)).toBe(true);
    expect(meetsGalaxusStockMoq(2, gld)).toBe(false);
    expect(meetsGalaxusStockMoq(1, gld)).toBe(false);
    expect(meetsGalaxusStockMoq(0, gld)).toBe(false);
    expect(meetsGalaxusStockMoq(1, { minimumOrderQuantity: 1, orderQuantitySteps: 1 })).toBe(true);
  });
});

