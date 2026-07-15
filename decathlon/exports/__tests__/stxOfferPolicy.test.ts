import { describe, expect, it } from "vitest";
import {
  isDecathlonStxOfferDelisted,
  resolveDecathlonStxOfferStock,
} from "../stxOfferPolicy";

const stxCandidate = (price: number, deliveryType = "express_standard", stock = 10) => ({
  providerKey: "STX_1234567890123",
  gtin: "1234567890123",
  mapping: {},
  kickdbVariant: null,
  product: null,
  variant: {
    supplierVariantId: "stx_1",
    price,
    stock,
    deliveryType,
    manualLock: false,
  },
});

describe("STX offer delist policy", () => {
  it("delists only when list price exceeds 400", () => {
    expect(
      isDecathlonStxOfferDelisted({
        supplierKey: "stx",
        buyNow: 300,
        listPriceTtc: 410,
      })
    ).toBe(true);
  });

  it("does not delist when list is under cap", () => {
    expect(
      isDecathlonStxOfferDelisted({
        supplierKey: "stx",
        buyNow: 180,
        listPriceTtc: 269,
      })
    ).toBe(false);
  });

  it("returns stock 0 only when list exceeds cap", () => {
    expect(resolveDecathlonStxOfferStock(stxCandidate(300), 410)).toBe(0);
  });

  it("returns stock 1 for listable express STX", () => {
    expect(resolveDecathlonStxOfferStock(stxCandidate(106), 149)).toBe(1);
  });
});
