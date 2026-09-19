import { describe, expect, it } from "vitest";
import { buildTusObservationId, decideTusPublishedQty } from "./tusQty";

describe("buildTusObservationId", () => {
  it("distinguishes parent vs variant", () => {
    expect(buildTusObservationId({ parentWooId: 10, variantWooId: 20, gtin: "1" })).toBe(
      "tus_p10_v20_1"
    );
    expect(buildTusObservationId({ parentWooId: null, variantWooId: 30, gtin: "2" })).toBe(
      "tus_p0_v30_2"
    );
  });
});

describe("tusQty", () => {
  it("Verfügbar 5 → halfCeil→3", () => {
    const d = decideTusPublishedQty({ verfuegbarQty: 5, purchasable: true, inStock: true });
    expect(d.sourceQty).toBe(5);
    expect(d.proposedQty).toBe(3);
  });
  it("N=1 → 1", () => {
    expect(
      decideTusPublishedQty({ verfuegbarQty: 1, purchasable: true, inStock: true }).proposedQty
    ).toBe(1);
  });
  it("Nicht vorrätig copy → 0", () => {
    const d = decideTusPublishedQty({
      verfuegbarQty: 5,
      purchasable: true,
      inStock: true,
      htmlOrText: "Nicht vorrätig",
    });
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("pdp_oos_text");
  });
  it("!purchasable → 0", () => {
    expect(
      decideTusPublishedQty({ verfuegbarQty: 5, purchasable: false, inStock: false }).proposedQty
    ).toBe(0);
  });
  it("preorder → 0", () => {
    expect(
      decideTusPublishedQty({ verfuegbarQty: 5, isPreorder: true, purchasable: true }).proposedQty
    ).toBe(0);
  });
  it("no qty → 0 never invent", () => {
    const d = decideTusPublishedQty({ purchasable: true, inStock: true });
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("no_qty");
  });
  it("cartMax 9999 rejected", () => {
    expect(
      decideTusPublishedQty({ cartMax: 9999, purchasable: true, inStock: true }).proposedQty
    ).toBe(0);
  });
  it("cartMax 4 accepted → 2", () => {
    expect(
      decideTusPublishedQty({ cartMax: 4, purchasable: true, inStock: true }).proposedQty
    ).toBe(2);
  });
});
