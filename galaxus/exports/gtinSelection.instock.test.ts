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

  it("reports the loser whichever order the rows arrive in", () => {
    for (const rows of [
      [mapping("ner", 50, 3), mapping("stx", 81.96, 5)],
      [mapping("stx", 81.96, 5), mapping("ner", 50, 3)],
    ]) {
      const best = new Map();
      const losers: string[] = [];
      accumulateBestCandidates(rows, best, {
        preferInStock: true,
        requireImage: false,
        onLoser: (c) => losers.push(c.providerKey),
      });
      expect(best.get(GTIN)?.providerKey).toMatch(/^NER_/);
      expect(losers).toEqual([`STX_${GTIN}`]);
    }
  });

  it("normalizeGtinKey elects one winner across UPC-12 / EAN-13 spellings", () => {
    const upc = { ...mapping("ner", 219, 3), gtin: "198730461243" };
    upc.supplierVariant = { ...upc.supplierVariant, supplierVariantId: "ner_upc", gtin: "198730461243" };
    upc.supplierVariantId = "ner_upc";
    const ean = { ...mapping("stx", 120, 8), gtin: "0198730461243" };
    ean.supplierVariant = { ...ean.supplierVariant, supplierVariantId: "stx_ean", gtin: "0198730461243" };
    ean.supplierVariantId = "stx_ean";

    const exact = new Map();
    accumulateBestCandidates([upc, ean], exact, { preferInStock: true, requireImage: false });
    expect(exact.size).toBe(2);

    const normalized = new Map();
    const losers: string[] = [];
    accumulateBestCandidates([upc, ean], normalized, {
      preferInStock: true,
      requireImage: false,
      normalizeGtinKey: true,
      onLoser: (c) => losers.push(c.providerKey),
    });
    expect(normalized.size).toBe(1);
    expect(Array.from(normalized.values())[0].providerKey).toBe("STX_0198730461243");
    expect(losers).toEqual(["NER_198730461243"]);
  });

  it("legacy mode (off) keeps cheapest regardless of stock", () => {
    const best = new Map();
    accumulateBestCandidates([mapping("stx", 60, 0), mapping("ner", 187, 3)], best, { requireImage: false });
    expect(best.get(GTIN)?.providerKey).toMatch(/^STX_/i);
  });

  it("reconstructs providerKey for STX feed gate when slim offer/stock select omits providerKey", () => {
    const slimOfferMapping = {
      id: "m1",
      gtin: "0711719577171",
      supplierVariantId: "stx_manual_0711719577171",
      supplierVariant: {
        supplierVariantId: "stx_manual_0711719577171",
        supplierProductName: "Sony PlayStation 5 Slim Disc Edition",
        supplierBrand: "Sony",
        sourceImageUrl: "https://img/ps5.jpg",
        price: 1023.55,
        stock: 1,
      },
    };
    const best = new Map();
    accumulateBestCandidates([slimOfferMapping], best, {
      keyBy: "gtin",
      normalizeGtinKey: true,
      requireImage: true,
      preferInStock: true,
    });
    expect(best.size).toBe(1);
    expect(Array.from(best.values())[0].providerKey).toBe("STX_0711719577171");
  });
});
