import { describe, expect, it } from "vitest";
import {
  decideFanPublishedQtyFromPage,
  fanHalfCeil,
  fanSalePublishQty,
  parseFanStkAufLager,
} from "@/inventory/supplierStock/fanQty";

describe("fanHalfCeil", () => {
  it("matches chef table", () => {
    expect(fanHalfCeil(0)).toBe(0);
    expect(fanHalfCeil(1)).toBe(1);
    expect(fanHalfCeil(2)).toBe(1);
    expect(fanHalfCeil(3)).toBe(2);
    expect(fanHalfCeil(10)).toBe(5);
  });
});

describe("fanSalePublishQty", () => {
  it("uses max(0, ceil((N-2)/2))", () => {
    expect(fanSalePublishQty(0)).toBe(0);
    expect(fanSalePublishQty(1)).toBe(0);
    expect(fanSalePublishQty(2)).toBe(0);
    expect(fanSalePublishQty(3)).toBe(1);
    expect(fanSalePublishQty(4)).toBe(1);
    expect(fanSalePublishQty(10)).toBe(4);
  });
});

describe("parseFanStkAufLager", () => {
  it("reads exact and 10+", () => {
    expect(parseFanStkAufLager("3 Stk. auf Lager")).toEqual({
      qty: 3,
      isTenPlus: false,
      label: "3 Stk. auf Lager",
    });
    expect(parseFanStkAufLager("10+ Stk. auf Lager")).toEqual({
      qty: 10,
      isTenPlus: true,
      label: "10+ Stk. auf Lager",
    });
    expect(parseFanStkAufLager("0 Stk. auf Lager").qty).toBe(0);
  });
});

describe("decideFanPublishedQtyFromPage", () => {
  it("N=0 → proposed 0", () => {
    const d = decideFanPublishedQtyFromPage({
      htmlOrText: "SOFORT VERFÜGBAR 0 Stk. auf Lager",
      productUrl: "https://www.fantasywelt.de/Foo",
    });
    expect(d.proposedQty).toBe(0);
    expect(d.hasPositiveProof).toBe(false);
  });

  it("N=1 → 1", () => {
    const d = decideFanPublishedQtyFromPage({
      htmlOrText: "SOFORT VERFÜGBAR Lieferzeit 1-2 Werktage 1 Stk. auf Lager",
      productUrl: "https://www.fantasywelt.de/Umbrella-Collectors",
    });
    expect(d.sourceQty).toBe(1);
    expect(d.proposedQty).toBe(1);
    expect(d.hasPositiveProof).toBe(true);
  });

  it("N=2 → 1", () => {
    const d = decideFanPublishedQtyFromPage({
      htmlOrText: "SOFORT VERFÜGBAR 2 Stk. auf Lager",
      productUrl: "https://www.fantasywelt.de/MLP",
    });
    expect(d.proposedQty).toBe(1);
  });

  it("N=3 → 2", () => {
    const d = decideFanPublishedQtyFromPage({
      htmlOrText: "SOFORT VERFÜGBAR 3 Stk. auf Lager",
      productUrl: "https://www.fantasywelt.de/You-Little-Stinker-Pig-Edition-EN",
    });
    expect(d.proposedQty).toBe(2);
  });

  it("10+ without SALE → treat as 10 then halfCeil → 5", () => {
    const d = decideFanPublishedQtyFromPage({
      htmlOrText: "SOFORT VERFÜGBAR 10+ Stk. auf Lager",
      productUrl: "https://www.fantasywelt.de/Some-Game-EN",
    });
    expect(d.sourceQty).toBe(10);
    expect(d.isTenPlus).toBe(true);
    expect(d.proposedQty).toBe(5);
  });

  it("SALE 10+ → max(0, ceil((10-2)/2)) = 4", () => {
    const d = decideFanPublishedQtyFromPage({
      htmlOrText: "SOFORT VERFÜGBAR 10+ Stk. auf Lager",
      productUrl: "https://www.fantasywelt.de/SALE-Umbrella-Academy-The-Board-Game-Core-Game-EN",
    });
    expect(d.isSale).toBe(true);
    expect(d.sourceQty).toBe(10);
    expect(d.proposedQty).toBe(4);
  });

  it("preorder → 0 no positive proof", () => {
    const d = decideFanPublishedQtyFromPage({
      htmlOrText:
        "VORBESTELLBAR Warten auf aktualisierten Erscheinungstermin des Herstellers! 0 Stk. auf Lager",
      productUrl: "https://www.fantasywelt.de/Necromolds-Battles-Box-EN",
    });
    expect(d.proposedQty).toBe(0);
    expect(d.hasPositiveProof).toBe(false);
    expect(d.reason).toBe("preorder_vorbestellbar");
  });

  it("Cloudflare → 0 no proof", () => {
    const d = decideFanPublishedQtyFromPage({
      htmlOrText: "Just a moment",
      productUrl: "https://www.fantasywelt.de/Foo",
      cloudflare: true,
    });
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("cloudflare_no_proof");
  });

  it("never invents default 5 when qty missing", () => {
    const d = decideFanPublishedQtyFromPage({
      htmlOrText: "SOFORT VERFÜGBAR Lieferzeit 1-2 Werktage IN DEN WARENKORB",
      productUrl: "https://www.fantasywelt.de/Foo",
    });
    expect(d.proposedQty).toBe(0);
    expect(d.sourceQty).toBeNull();
    expect(d.reason).toBe("no_stk_qty_on_page");
  });
});
