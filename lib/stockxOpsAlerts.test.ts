import { describe, expect, it } from "vitest";
import { detectUnlinkedGalaxusOrders } from "@/lib/stockxOpsAlerts";

/**
 * Detection mirrors the /galaxus/direct-delivery red "0/N linked" cards:
 * an active order whose STX supplier line still needs a StockX buy.
 */
function stxLine(orderId: string, lineId: string, extra: Record<string, unknown> = {}) {
  return {
    id: lineId,
    orderId,
    gtin: "00194495895729",
    quantity: 1,
    supplierPid: "STX_194495895729",
    supplierVariantId: "stx_194495895729",
    providerKey: "STX_194495895729",
    productName: "Nike Air Max Plus",
    description: "EU 35.5",
    ...extra,
  };
}

describe("detectUnlinkedGalaxusOrders", () => {
  it("flags an STX order with no linked buy (0/1 linked red card)", () => {
    const orders = [
      { id: "o-203504520", galaxusOrderId: "203504520", orderNumber: "203504520", orderDate: "2026-10-12" },
      { id: "o-206711320", galaxusOrderId: "206711320", orderNumber: "206711320", orderDate: "2026-10-12" },
    ];
    const lines = [stxLine("o-203504520", "l-1"), stxLine("o-206711320", "l-2")];

    const res = detectUnlinkedGalaxusOrders({
      orders,
      lines,
      stockxMatches: [],
      stxUnits: [],
      externalBuys: [],
    });

    const refs = res.map((r) => r.orderRef).sort();
    expect(refs).toEqual(["203504520", "206711320"]);
    for (const row of res) {
      expect(row.needsBuyCount).toBe(1);
      expect(row.linkedCount).toBe(0);
      expect(row.productTitle).toContain("Nike Air Max Plus");
    }
  });

  it("does NOT flag an order fully linked to a StockX buy", () => {
    const orders = [
      { id: "o-1", galaxusOrderId: "G1", orderNumber: "G1", orderDate: "2026-10-12" },
    ];
    const lines = [stxLine("o-1", "l-1")];
    const stockxMatches = [
      {
        galaxusOrderId: "o-1",
        galaxusOrderLineId: "l-1",
        galaxusGtin: "00194495895729",
        unitIndex: 0,
        stockxOrderId: "SX-ABC123",
        stockxOrderNumber: "SX-ABC123",
        stockxAmount: 120,
        stockxCurrencyCode: "CHF",
        stockxAwb: null,
        matchType: "AUTO_LINK",
      },
    ];

    const res = detectUnlinkedGalaxusOrders({ orders, lines, stockxMatches, stxUnits: [], externalBuys: [] });
    expect(res).toHaveLength(0);
  });

  it("ignores warehouse-stock (THE_/NER_) lines — not a StockX repurchase risk", () => {
    const orders = [{ id: "o-wh", galaxusOrderId: "GWH", orderNumber: "GWH", orderDate: "2026-10-12" }];
    const lines = [
      stxLine("o-wh", "l-wh", { supplierPid: "THE_ABC", providerKey: "THE_ABC", supplierSku: "THE_ABC" }),
    ];
    const res = detectUnlinkedGalaxusOrders({ orders, lines, stockxMatches: [], stxUnits: [], externalBuys: [] });
    expect(res).toHaveLength(0);
  });
});
