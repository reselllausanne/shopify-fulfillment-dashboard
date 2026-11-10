import { describe, expect, it } from "vitest";
import { accumulateBestCandidates } from "@/galaxus/exports/gtinSelection";

const GTIN = "4067892061461";
function mapping(prefix: string, price: number, stock: number) {
  const svId = `${prefix}_${GTIN}`;
  return {
    gtin: GTIN,
    supplierVariantId: svId,
    supplierKey: prefix,
    supplierVariant: {
      supplierVariantId: svId,
      providerKey: svId,
      supplierProductName: "adidas Samba OG",
      supplierBrand: "adidas",
      sourceImageUrl: "https://img/x.jpg",
      hostedImageUrl: "https://img/x.jpg",
      price,
      stock,
      gtin: GTIN,
    },
  };
}

describe("accumulateBestCandidates preferInStock", () => {
  it("cheapest wins when both in stock", () => {
    const best = new Map();
    accumulateBestCandidates([mapping("ner", 187, 3), mapping("stx", 60, 2)], best, { preferInStock: true, requireImage: false });
    expect(best.get(GTIN)?.providerKey).toMatch(/^STX_/i);
  });

  it("in-stock NER beats cheaper sold-out STX", () => {
    const best = new Map();
    accumulateBestCandidates([mapping("stx", 60, 0), mapping("ner", 187, 3)], best, { preferInStock: true, requireImage: false });
    expect(best.get(GTIN)?.providerKey).toMatch(/^NER_/i);
  });

  it("legacy mode (off) keeps cheapest regardless of stock", () => {
    const best = new Map();
    accumulateBestCandidates([mapping("stx", 60, 0), mapping("ner", 187, 3)], best, { requireImage: false });
    expect(best.get(GTIN)?.providerKey).toMatch(/^STX_/i);
  });
});
