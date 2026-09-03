import { describe, expect, it, vi } from "vitest";
import { rewriteGalaxusOrderLinesPreservingLinks } from "@/galaxus/orders/rewriteLinesPreservingLinks";

describe("rewriteGalaxusOrderLinesPreservingLinks", () => {
  it("remounts GalaxusStockxMatch onto new line ids by lineNumber", async () => {
    const createdMatches: any[] = [];
    const oldLineId = "old-line-1";
    const newLineId = "new-line-1";

    const tx = {
      galaxusOrderLine: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: oldLineId, lineNumber: 1, gtin: "123" }])
          .mockResolvedValueOnce([{ id: newLineId, lineNumber: 1, gtin: "123" }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      galaxusStockxMatch: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "match-1",
            galaxusOrderId: "order-uuid",
            galaxusOrderLineId: oldLineId,
            unitIndex: 0,
            galaxusLineNumber: 1,
            galaxusGtin: "123",
            galaxusProductName: "Shoe",
            galaxusQuantity: 1,
            galaxusUnitNetPrice: 10,
            galaxusLineNetAmount: 10,
            galaxusVatRate: 8.1,
            galaxusCurrencyCode: "CHF",
            stockxOrderNumber: "03-KV1K3NG08T",
            stockxOrderId: "03-KV1K3NG08T",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        create: vi.fn().mockImplementation(async ({ data }) => {
          createdMatches.push(data);
          return data;
        }),
      },
      galaxusExternalBuy: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
    };

    const result = await rewriteGalaxusOrderLinesPreservingLinks(tx as any, "order-uuid", [
      {
        lineNumber: 1,
        supplierPid: "STX_123",
        buyerPid: null,
        orderUnit: null,
        supplierSku: null,
        supplierVariantId: "stx_v",
        productName: "Shoe",
        description: null,
        size: "EU 39",
        gtin: "123",
        providerKey: "STX",
        quantity: 1,
        qtyConfirmed: 1,
        vatRate: 8.1,
        taxAmountPerUnit: null,
        unitNetPrice: 10,
        lineNetAmount: 10,
        priceLineAmount: null,
        arrivalDateStart: null,
        arrivalDateEnd: null,
        currencyCode: "CHF",
      },
    ]);

    expect(result.remountedMatches).toBe(1);
    expect(createdMatches[0].galaxusOrderLineId).toBe(newLineId);
    expect(createdMatches[0].stockxOrderNumber).toBe("03-KV1K3NG08T");
    expect(createdMatches[0].id).toBeUndefined();
  });
});
