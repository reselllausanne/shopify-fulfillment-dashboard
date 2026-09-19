import { describe, expect, it } from "vitest";
import { decideExlPublishedQty, parseExlAvailability } from "./exlQty";

describe("exlQty", () => {
  it("2-3 Werktage → proposed 1 quantityUnknown", () => {
    const d = decideExlPublishedQty(
      parseExlAvailability({ stockLabel: "in_stock", availabilityText: "Lieferbar in 2-3 Werktagen" })
    );
    expect(d.proposedQty).toBe(1);
    expect(d.quantityUnknown).toBe(true);
    expect(d.reason).toBe("delivery_2_3_werktage");
  });

  it("2-4 Werktage → proposed 1", () => {
    const d = decideExlPublishedQty(
      parseExlAvailability({ stockLabel: "in_stock", availabilityText: "In 2-4 Werktagen bei Ihnen" })
    );
    expect(d.proposedQty).toBe(1);
  });

  it("Derzeit vergriffen → 0", () => {
    const d = decideExlPublishedQty(
      parseExlAvailability({ stockLabel: "out_of_stock", availabilityText: "Derzeit vergriffen" })
    );
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("unavailable");
  });

  it("preorder → 0", () => {
    const d = decideExlPublishedQty(
      parseExlAvailability({ stockLabel: "preorder", availabilityText: "Vorbestellbar" })
    );
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("preorder");
  });

  it("no page proof → 0 never default 5", () => {
    const d = decideExlPublishedQty(
      parseExlAvailability({ stockLabel: null, availabilityText: null })
    );
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("no_page_proof");
  });

  it("green in_stock without exact text → 1", () => {
    const d = decideExlPublishedQty(
      parseExlAvailability({ stockLabel: "in_stock_unquantified", availabilityText: "" })
    );
    expect(d.proposedQty).toBe(1);
    expect(d.reason).toBe("green_in_stock_unquantified");
  });
});
