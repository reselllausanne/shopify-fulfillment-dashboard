import { describe, expect, it } from "vitest";
import { decideVenPublishedQty } from "./venQty";

describe("venQty", () => {
  it("buyable + trusted page obs → 1", () => {
    const d = decideVenPublishedQty({
      buyableSofort: true,
      pageObservedThisRun: true,
      stockSource: "stock_quantity_number",
      rawQty: 4,
    });
    expect(d.proposedQty).toBe(1);
    expect(d.hasPositiveProof).toBe(true);
  });
  it("sQuantity_max untrusted → 0", () => {
    const d = decideVenPublishedQty({
      buyableSofort: true,
      pageObservedThisRun: true,
      stockSource: "sQuantity_max",
      rawQty: 100,
    });
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("sQuantity_max_untrusted");
  });
  it("default_stock rejected", () => {
    expect(
      decideVenPublishedQty({
        buyableSofort: true,
        pageObservedThisRun: true,
        stockSource: "default_stock",
      }).proposedQty
    ).toBe(0);
  });
  it("!sofort → 0", () => {
    expect(
      decideVenPublishedQty({
        buyableSofort: false,
        pageObservedThisRun: true,
        stockSource: "stock_quantity_number",
      }).proposedQty
    ).toBe(0);
  });
  it("no page obs → 0 (never mass-write 1)", () => {
    expect(
      decideVenPublishedQty({
        buyableSofort: true,
        pageObservedThisRun: false,
        stockSource: "stock_quantity_number",
      }).proposedQty
    ).toBe(0);
  });
  it("no stock source → 0", () => {
    expect(
      decideVenPublishedQty({ buyableSofort: true, pageObservedThisRun: true }).proposedQty
    ).toBe(0);
  });
});
