import { describe, expect, it } from "vitest";
import { decideBwzPublishedQty, parseBwzStock } from "./bwzQty";

describe("bwzQty", () => {
  it("N=4 → halfCeil→2", () => {
    const d = decideBwzPublishedQty(
      parseBwzStock({ quantity: 4, isSoldOut: false, isBuyable: true })
    );
    expect(d.sourceQty).toBe(4);
    expect(d.proposedQty).toBe(2);
  });

  it("N=1 → 1", () => {
    const d = decideBwzPublishedQty(parseBwzStock({ quantity: 1, isBuyable: true }));
    expect(d.proposedQty).toBe(1);
  });

  it("Gutschein → 0 reason gutschein", () => {
    const d = decideBwzPublishedQty(
      parseBwzStock({ quantity: 50, productName: "Baby-Walz Geschenkgutschein 100 CHF" })
    );
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("gutschein");
  });

  it("isSoldOut → 0", () => {
    const d = decideBwzPublishedQty(parseBwzStock({ quantity: 5, isSoldOut: true }));
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("isSoldOut");
  });

  it("no nuxt qty → 0 never invent", () => {
    const d = decideBwzPublishedQty(parseBwzStock({ quantity: null, isBuyable: true }));
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("no_nuxt_qty");
    expect(d.sourceQty).toBeNull();
  });

  it("zero qty → 0", () => {
    const d = decideBwzPublishedQty(parseBwzStock({ quantity: 0, isBuyable: true }));
    expect(d.proposedQty).toBe(0);
  });
});
