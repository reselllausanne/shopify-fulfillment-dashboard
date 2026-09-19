import { describe, expect, it } from "vitest";
import { decideExlPublishedQty } from "./exlQty";

describe("exlQty", () => {
  it("2-3 Werktage → 1 quantityUnknown", () => {
    const d = decideExlPublishedQty({
      availabilityText: "Auslieferung innert 2 bis 3 Werktagen.",
      stockLabel: "in_stock",
    });
    expect(d.proposedQty).toBe(1);
    expect(d.quantityUnknown).toBe(true);
  });
  it("2-4 Werktage → 1", () => {
    expect(
      decideExlPublishedQty({ availabilityText: "in 2-4 Werktagen", stockLabel: "in_stock" })
        .proposedQty
    ).toBe(1);
  });
  it("Derzeit vergriffen → 0", () => {
    expect(
      decideExlPublishedQty({ availabilityText: "Derzeit vergriffen", stockLabel: "out_of_stock" })
        .proposedQty
    ).toBe(0);
  });
  it("preorder → 0", () => {
    expect(
      decideExlPublishedQty({ availabilityText: "Vorbestellbar", stockLabel: "preorder" })
        .proposedQty
    ).toBe(0);
  });
  it("invalid scrape → 0 no proof", () => {
    const d = decideExlPublishedQty({ scrapeValid: false });
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("scrape_invalid_no_proof");
  });
  it("no page proof → 0 never default 5", () => {
    expect(decideExlPublishedQty({}).proposedQty).toBe(0);
  });
  it("green in_stock unquantified → 1", () => {
    expect(
      decideExlPublishedQty({ stockLabel: "in_stock_unquantified", availabilityText: "" })
        .proposedQty
    ).toBe(1);
  });
});
