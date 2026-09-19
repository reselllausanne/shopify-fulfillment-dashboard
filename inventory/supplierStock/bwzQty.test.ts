import { describe, expect, it } from "vitest";
import { decideBwzPublishedQty } from "./bwzQty";

describe("bwzQty", () => {
  it("N=4 inStock → halfCeil→2", () => {
    const d = decideBwzPublishedQty({ nuxtQty: 4, inStock: true });
    expect(d.sourceQty).toBe(4);
    expect(d.proposedQty).toBe(2);
  });
  it("N=34 → 17", () => {
    expect(decideBwzPublishedQty({ nuxtQty: 34, inStock: true }).proposedQty).toBe(17);
  });
  it("N=1 → 1", () => {
    expect(decideBwzPublishedQty({ nuxtQty: 1, inStock: true }).proposedQty).toBe(1);
  });
  it("gutschein → excluded 0", () => {
    const d = decideBwzPublishedQty({ nuxtQty: 999, inStock: true, name: "Baby-Walz Geschenkgutschein 200" });
    expect(d.excluded).toBe(true);
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("gutschein");
  });
  it("not in stock → 0", () => {
    const d = decideBwzPublishedQty({ nuxtQty: 5, inStock: false });
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("not_in_stock");
  });
  it("missing qty → 0 never invent", () => {
    const d = decideBwzPublishedQty({ nuxtQty: null, inStock: true });
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("no_nuxt_qty");
  });
});
