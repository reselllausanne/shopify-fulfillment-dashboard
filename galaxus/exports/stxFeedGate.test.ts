import { describe, expect, it } from "vitest";
import {
  classifyStxBrand,
  normalizeStxBrand,
  STX_HARD_CAP_CHF,
} from "@/galaxus/exports/stxBrandBuckets";
import {
  isStxSupplierKey,
  shouldOmitStxFromGalaxusFeed,
  STX_NONFOCUS_MAX_CHF,
} from "@/galaxus/exports/stxFeedGate";

describe("classifyStxBrand", () => {
  it("classifies focus brands as FOCUS regardless of case / spacing", () => {
    expect(classifyStxBrand("Nike")).toBe("FOCUS");
    expect(classifyStxBrand("  jordan  ")).toBe("FOCUS");
    expect(classifyStxBrand("Hoka One One")).toBe("FOCUS");
    expect(classifyStxBrand("Pokemon")).toBe("FOCUS");
  });

  it("classifies luxury / haute couture brands as LUXURY_KEEP", () => {
    expect(classifyStxBrand("Gucci")).toBe("LUXURY_KEEP");
    expect(classifyStxBrand("Dior")).toBe("LUXURY_KEEP");
    expect(classifyStxBrand("Arc'teryx")).toBe("LUXURY_KEEP");
    expect(classifyStxBrand("Bearbrick")).toBe("LUXURY_KEEP");
    expect(classifyStxBrand("KAWS")).toBe("LUXURY_KEEP");
    expect(classifyStxBrand("Travis Scott")).toBe("LUXURY_KEEP");
  });

  it("defaults unknown brands to MAINSTREAM", () => {
    expect(classifyStxBrand("Supreme")).toBe("MAINSTREAM");
    expect(classifyStxBrand("adidas")).toBe("MAINSTREAM");
    expect(classifyStxBrand("Dr. Martens")).toBe("MAINSTREAM");
    expect(classifyStxBrand("The North Face")).toBe("MAINSTREAM");
    expect(classifyStxBrand("Vans")).toBe("MAINSTREAM");
    expect(classifyStxBrand("BAPE")).toBe("MAINSTREAM");
    expect(classifyStxBrand("")).toBe("MAINSTREAM");
    expect(classifyStxBrand(null)).toBe("MAINSTREAM");
  });

  it("normalizes brand whitespace / casing", () => {
    expect(normalizeStxBrand("  Nike  ")).toBe("nike");
    expect(normalizeStxBrand("Hoka  One   One")).toBe("hoka one one");
  });
});

describe("isStxSupplierKey", () => {
  it("recognizes STX via supplierKey, providerKey, or supplierVariantId prefix", () => {
    expect(isStxSupplierKey({ supplierKey: "stx" })).toBe(true);
    expect(isStxSupplierKey({ providerKey: "STX_194498920039" })).toBe(true);
    expect(
      isStxSupplierKey({ supplierVariantId: "stx_7fb6d2a0-4f02-483a-bd7d-d44e3d6541ff" })
    ).toBe(true);
  });

  it("rejects other suppliers", () => {
    expect(isStxSupplierKey({ supplierKey: "wel" })).toBe(false);
    expect(isStxSupplierKey({ providerKey: "GLD_123" })).toBe(false);
    expect(isStxSupplierKey({ supplierVariantId: "ner_abc" })).toBe(false);
    expect(isStxSupplierKey({})).toBe(false);
  });
});

describe("shouldOmitStxFromGalaxusFeed", () => {
  it("ignores non-STX rows", () => {
    expect(
      shouldOmitStxFromGalaxusFeed({
        supplierKey: "wel",
        supplierBrand: "adidas",
        price: 9999,
      })
    ).toEqual({ omit: false });
  });

  it("hard-caps every STX row at CHF 10 000", () => {
    expect(STX_HARD_CAP_CHF).toBe(10_000);
    // Focus brand still capped
    expect(
      shouldOmitStxFromGalaxusFeed({
        supplierKey: "stx",
        supplierBrand: "Nike",
        price: 66_572.52,
      })
    ).toEqual({ omit: true, reason: "HARD_CAP_10K" });
    // Luxury still capped
    expect(
      shouldOmitStxFromGalaxusFeed({
        supplierKey: "stx",
        supplierBrand: "Supreme",
        price: 533_080.8,
      })
    ).toEqual({ omit: true, reason: "HARD_CAP_10K" });
    expect(
      shouldOmitStxFromGalaxusFeed({
        supplierKey: "stx",
        supplierBrand: "Gucci",
        price: 10_000,
      })
    ).toEqual({ omit: true, reason: "HARD_CAP_10K" });
  });

  it("drops mainstream STX above CHF 500 but keeps them at/below", () => {
    expect(STX_NONFOCUS_MAX_CHF).toBe(500);
    expect(
      shouldOmitStxFromGalaxusFeed({
        supplierKey: "stx",
        supplierBrand: "adidas",
        price: 812,
      })
    ).toEqual({ omit: true, reason: "NONFOCUS_OVER_500" });
    expect(
      shouldOmitStxFromGalaxusFeed({
        supplierKey: "stx",
        supplierBrand: "Supreme",
        price: 501,
      })
    ).toEqual({ omit: true, reason: "NONFOCUS_OVER_500" });
    expect(
      shouldOmitStxFromGalaxusFeed({
        supplierKey: "stx",
        supplierBrand: "Vans",
        price: 500,
      })
    ).toEqual({ omit: false });
  });

  it("keeps focus brands over CHF 500 (until the hard cap)", () => {
    expect(
      shouldOmitStxFromGalaxusFeed({
        supplierKey: "stx",
        supplierBrand: "Nike",
        price: 800,
      })
    ).toEqual({ omit: false });
    expect(
      shouldOmitStxFromGalaxusFeed({
        supplierKey: "stx",
        supplierBrand: "Jordan",
        price: 1500,
      })
    ).toEqual({ omit: false });
  });

  it("keeps luxury / art-toy brands over CHF 500 (until the hard cap)", () => {
    for (const brand of ["Gucci", "Dior", "Chanel", "Bearbrick", "KAWS", "Travis Scott", "Arc'teryx"]) {
      expect(
        shouldOmitStxFromGalaxusFeed({
          supplierKey: "stx",
          supplierBrand: brand,
          price: 1500,
        })
      ).toEqual({ omit: false });
    }
  });

  it("accepts price passed as a string", () => {
    expect(
      shouldOmitStxFromGalaxusFeed({
        supplierKey: "stx",
        supplierBrand: "adidas",
        price: "812.34",
      })
    ).toEqual({ omit: true, reason: "NONFOCUS_OVER_500" });
  });

  it("infers STX from providerKey when supplierKey is missing", () => {
    expect(
      shouldOmitStxFromGalaxusFeed({
        providerKey: "STX_194498920039",
        supplierBrand: "adidas",
        price: 812,
      })
    ).toEqual({ omit: true, reason: "NONFOCUS_OVER_500" });
  });
});
