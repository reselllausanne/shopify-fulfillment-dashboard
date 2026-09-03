import { describe, expect, it } from "vitest";
import {
  attachProcurementToLines,
  buildLinkedCountByOrderId,
  countLinkedLinesForList,
} from "@/galaxus/orders/lineProcurement";

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
    expect(map.linked.get("uuid-1")).toBe(1);
    expect(map.needsBuy.get("uuid-1")).toBe(0);
  });
});

describe("attachProcurementToLines", () => {
  it("surfaces cost/ETA from StxPurchaseUnit when GalaxusStockxMatch missing (Linked sync)", () => {
    const eta = new Date("2026-08-07T00:00:00.000Z");
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
    const stx = {
      buckets: [
        {
          gtin: "198686324128",
          supplierVariantId: "stx_abc",
          needed: 1,
          linked: 1,
        },
      ],
    };
    const stxUnits = [
      {
        gtin: "198686324128",
        supplierVariantId: "stx_abc",
        stockxOrderId: "01-W9AQV85TWT",
        stockxOrderNumber: "01-W9AQV85TWT",
        stockxSettledAmount: 131.79,
        stockxSettledCurrency: "CHF",
        etaMin: eta,
        etaMax: eta,
        awb: null,
        cancelledAt: null,
      },
    ];

    const [row] = attachProcurementToLines(lines, stx, [], stxUnits);
    expect(row.procurement.ok).toBe(true);
    expect(row.procurement.source).toBe("stx_sync");
    expect(row.procurement.stockxCostChf).toBe(131.79);
    expect(row.procurement.stockxEstimatedDelivery).toEqual(eta);
  });
});
