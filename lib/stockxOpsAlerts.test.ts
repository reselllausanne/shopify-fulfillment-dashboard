import { describe, expect, it } from "vitest";
import {
  detectUnlinkedGalaxusOrders,
  detectUnlinkedShopifyOrders,
  isShopifyLineStockxIneligibleForAlert,
  type ShopifyUnlinkedLineInput,
} from "@/lib/stockxOpsAlerts";

const DAY = 86_400_000;

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

describe("detectUnlinkedShopifyOrders", () => {
  const now = Date.UTC(2026, 9, 27); // 2026-10-27
  const windowFloorMs = now - 60 * DAY;
  const cutoffMs = now - 14 * DAY;
  const inWindowIso = new Date(now - 20 * DAY).toISOString(); // 20d old → eligible

  function line(extra: Partial<ShopifyUnlinkedLineInput> = {}): ShopifyUnlinkedLineInput {
    return {
      shopifyOrderId: "5001",
      shopifyOrderName: "#5001",
      shopifyLineItemId: "gid://shopify/LineItem/900",
      title: "Nike Air Max Plus Pink Fade",
      sku: "CZ7931-100",
      createdAtIso: inWindowIso,
      ...extra,
    };
  }

  const base = {
    now,
    windowFloorMs,
    cutoffMs,
    linkedLineItemIds: new Set<string>(),
    excludeOrderNames: new Set<string>(),
  };

  it("flags a hard-unlinked StockX-eligible order", () => {
    const res = detectUnlinkedShopifyOrders({ ...base, candidateLines: [line()] });
    expect(res).toHaveLength(1);
    expect(res[0]!.orderRef).toBe("#5001");
    expect(res[0]!.shopifyOrderId).toBe("5001");
    expect(res[0]!.unlinkedLineCount).toBe(1);
  });

  it("skips a line already linked to a real StockX buy", () => {
    const res = detectUnlinkedShopifyOrders({
      ...base,
      linkedLineItemIds: new Set(["gid://shopify/LineItem/900"]),
      candidateLines: [line()],
    });
    expect(res).toHaveLength(0);
  });

  it("skips orders with a plausible buy candidate (buyable-in-progress / medium email)", () => {
    const res = detectUnlinkedShopifyOrders({
      ...base,
      excludeOrderNames: new Set(["#5001"]),
      candidateLines: [line()],
    });
    expect(res).toHaveLength(0);
  });

  it("excludes non-StockX brands (BAPE / Essentials / Crocs / Fear of God / watches)", () => {
    const titles = [
      "BAPE A Bathing Ape Shark Hoodie",
      "Fear of God Essentials Fleece Hoodie",
      "Crocs Classic Clog Black",
      "Fear of God 1977 Sneaker",
      "Rolex Submariner Watch",
    ];
    for (const title of titles) {
      expect(isShopifyLineStockxIneligibleForAlert({ title, sku: null })).toBe(true);
    }
    const res = detectUnlinkedShopifyOrders({
      ...base,
      candidateLines: titles.map((title, i) =>
        line({ title, shopifyOrderId: `b${i}`, shopifyLineItemId: `gid://shopify/LineItem/${i}` })
      ),
    });
    expect(res).toHaveLength(0);
  });

  it("respects the age window (too new or too old excluded)", () => {
    const tooNew = line({
      shopifyOrderId: "new",
      shopifyLineItemId: "gid://shopify/LineItem/new",
      createdAtIso: new Date(now - 5 * DAY).toISOString(),
    });
    const tooOld = line({
      shopifyOrderId: "old",
      shopifyLineItemId: "gid://shopify/LineItem/old",
      createdAtIso: new Date(now - 90 * DAY).toISOString(),
    });
    const res = detectUnlinkedShopifyOrders({ ...base, candidateLines: [tooNew, tooOld] });
    expect(res).toHaveLength(0);
  });
});
