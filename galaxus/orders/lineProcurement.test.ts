import { describe, expect, it } from "vitest";
import { buildLinkedCountByOrderId, countLinkedLinesForList } from "@/galaxus/orders/lineProcurement";

describe("countLinkedLinesForList", () => {
  it("counts stx_sync purchase units even when GalaxusStockxMatch is missing", () => {
    const lines = [
      {
        id: "line-1",
        gtin: "198686324128",
        quantity: 1,
        supplierPid: "STX_198686324128",
        supplierVariantId: "stx_abc",
        providerKey: "STX",
      },
    ];
    const stxUnits = [
      {
        gtin: "198686324128",
        supplierVariantId: "stx_abc",
        stockxOrderId: "01-W9AQV85TWT",
        stockxOrderNumber: "01-W9AQV85TWT",
        cancelledAt: null,
      },
    ];

    expect(countLinkedLinesForList(lines, [], stxUnits)).toBe(1);
    expect(countLinkedLinesForList(lines, [], [])).toBe(0);
  });

  it("counts warehouse-stock lines as linked without StockX", () => {
    const lines = [
      {
        id: "line-wh",
        gtin: "111",
        quantity: 1,
        supplierSku: "NER_111",
        providerKey: "NER_111",
      },
    ];
    expect(countLinkedLinesForList(lines, [], [])).toBe(1);
  });
});

describe("buildLinkedCountByOrderId", () => {
  it("keys matches by internal id and units by external galaxusOrderId", () => {
    const map = buildLinkedCountByOrderId({
      orders: [{ id: "uuid-1", galaxusOrderId: "197984245" }],
      lines: [
        {
          id: "line-1",
          orderId: "uuid-1",
          gtin: "198686324128",
          quantity: 1,
          supplierPid: "STX_198686324128",
          supplierVariantId: "stx_abc",
          providerKey: "STX",
        },
      ],
      stockxMatches: [],
      stxUnits: [
        {
          galaxusOrderId: "197984245",
          gtin: "198686324128",
          supplierVariantId: "stx_abc",
          stockxOrderId: "01-W9AQV85TWT",
          cancelledAt: null,
        },
      ],
    });
    expect(map.get("uuid-1")).toBe(1);
  });
});
