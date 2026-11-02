import { describe, expect, it } from "vitest";
import { buildCustomerNarrative } from "@/lib/stockxDelayRebuy/narratives";
import type { DelayRebuyCase } from "@/lib/stockxDelayRebuy/types";

function baseCase(over: Partial<DelayRebuyCase> = {}): DelayRebuyCase {
  const start = new Date("2026-11-10T12:00:00Z");
  const end = new Date("2026-11-18T12:00:00Z");
  return {
    orderMatchId: "m1",
    shopifyOrderName: "#9999",
    shopifyLineItemId: "li1",
    shopifyOrderId: "o1",
    productTitle: "Test Shoe",
    sku: "ABC",
    sizeEU: "42",
    saleChf: 199,
    imageUrl: null,
    customerFirstName: "Alex",
    customerEmail: "a@example.com",
    trackingToken: null,
    stockxOrderNumber: "03-XXX",
    stockxStatus: "ORDER_CREATED",
    checkoutType: "STANDARD",
    rebuyLane: "STANDARD",
    etaStart: null,
    etaEnd: null,
    daysPastEta: 2,
    precheck: {
      status: "buyable",
      stock: 1,
      expectedBuyChf: 100,
      marginPct: 0.3,
      detail: "ok",
      supplierVariantId: "sv1",
    } as any,
    slug: "test-shoe",
    sizeUS: "8.5",
    stockxCheckoutUrl: null,
    stockxPdpUrl: null,
    rebuyEtaStart: start,
    rebuyEtaEnd: end,
    announceEtaStart: start,
    announceEtaEnd: end,
    ...over,
  };
}

describe("buildCustomerNarrative", () => {
  it("delay mentions apology + ETA, never StockX", () => {
    const n = buildCustomerNarrative(baseCase(), "SUPPLIER_CHANGE_DELAY");
    expect(n.subject).toContain("#9999");
    expect(n.bodyParagraphs.join(" ")).toMatch(/Désolé/i);
    expect(n.bodyParagraphs.join(" ").toLowerCase()).not.toContain("stockx");
    expect(n.etaLine.length).toBeGreaterThan(5);
  });

  it("cancel-rebuy uses rebuy ETA window", () => {
    const n = buildCustomerNarrative(baseCase(), "CANCEL_REBUY_LEGIT");
    expect(n.headline).toMatch(/racheté/i);
    expect(n.bodyParagraphs.join(" ")).toMatch(/Désolé/i);
    expect(n.bodyParagraphs.join(" ").toLowerCase()).not.toContain("stockx");
  });
});
