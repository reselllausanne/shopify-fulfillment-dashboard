import { describe, expect, it } from "vitest";
import { buildClientPreviewHtml } from "@/lib/stockxDelayRebuy/emails";
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
  it("delay warns without claiming a new purchase or a fake ETA", () => {
    const n = buildCustomerNarrative(baseCase(), "SUPPLIER_CHANGE_DELAY");
    expect(n.subject).toContain("#9999");
    expect(n.greeting).toBe("Bonjour Alex,");
    expect(n.headline).toBe("Livraison retardée");
    expect(n.etaLine).toBe("Date à confirmer");
    expect(n.statusLine.length).toBeLessThan(80);
    expect(n.bodyParagraphs.join(" ")).toMatch(/retard/i);
    expect(n.bodyParagraphs.join(" ").toLowerCase()).not.toContain("stockx");
    expect(n.bodyParagraphs.join(" ")).not.toMatch(/autre vendeur|passé la commande|commandé/i);
    expect(n.shippingLabel).toBe("Standard");
  });

  it("german delay mail uses the checkout language", () => {
    const n = buildCustomerNarrative(baseCase(), "SUPPLIER_CHANGE_DELAY", "de");
    expect(n.language).toBe("de");
    expect(n.headline).toBe("Lieferung verzögert");
    expect(n.greeting).toBe("Hallo Alex,");
    expect(n.bodyParagraphs.join(" ").toLowerCase()).not.toContain("stockx");
    expect(n.chrome.faqUrl).toContain("/de/pages/faq");
  });

  it("cancel-rebuy uses rebuy ETA window", () => {
    const n = buildCustomerNarrative(baseCase(), "CANCEL_REBUY_LEGIT");
    expect(n.headline).toBe("Article remplacé");
    expect(n.statusLine).toMatch(/Nouvelle date/i);
    expect(n.bodyParagraphs.join(" ")).toMatch(/désolés/i);
    expect(n.bodyParagraphs.join(" ").toLowerCase()).not.toContain("stockx");
    expect(n.greeting).toBe("Bonjour Alex,");
  });

  it("express lane is a summary label, not a sentence", () => {
    const n = buildCustomerNarrative(baseCase({ rebuyLane: "EXPRESS" }), "SUPPLIER_CHANGE_DELAY");
    expect(n.shippingLabel).toBe("Prioritaire");
    expect(n.bodyParagraphs.join(" ")).not.toMatch(/prioritaire/i);
  });
});

describe("delay mail HTML placement", () => {
  it("puts greeting, ETA band, product image, then short body", () => {
    const c = baseCase({
      imageUrl: "https://cdn.example/shoe.jpg",
      productTitle: "Nike Dunk Low",
    });
    const n = buildCustomerNarrative(c, "SUPPLIER_CHANGE_DELAY");
    const html = buildClientPreviewHtml(c, n);
    const greetingAt = html.indexOf("Bonjour Alex,");
    const etaAt = html.indexOf("Livraison");
    const imgAt = html.indexOf('width="200"');
    const bodyAt = html.indexOf("prend du retard");
    expect(greetingAt).toBeGreaterThan(0);
    expect(etaAt).toBeGreaterThan(greetingAt);
    expect(imgAt).toBeGreaterThan(etaAt);
    expect(bodyAt).toBeGreaterThan(imgAt);
    expect(html).toContain("Nike Dunk Low");
    expect(html).toContain("#9999");
    expect(html.toLowerCase()).not.toContain("petit souci");
    expect(html).not.toMatch(/background:rgba\(0,0,0/);
  });
});
