import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { galaxusAssortmentBlockReason } from "@/galaxus/exports/assortmentPolicy";
import { resolveGalaxusProductCategoryPath } from "@/galaxus/exports/productClassification";
import { defaultGalaxusProductKind } from "@/galaxus/exports/galaxusCategoryPaths";

const SNEAKERS = "Mode > Alles in Mode > Schuhe > Sneakers";

beforeEach(() => {
  process.env.GALAXUS_REI_ALLOWLIST = "0";
  process.env.GALAXUS_NER_APPAREL_ONLY = "0";
  process.env.GALAXUS_DISABLED_SUPPLIERS = "";
  process.env.GALAXUS_MAX_RETAIL_CHF = "5000";
});
afterEach(() => {
  for (const k of [
    "GALAXUS_REI_ALLOWLIST",
    "GALAXUS_NER_APPAREL_ONLY",
    "GALAXUS_DISABLED_SUPPLIERS",
    "GALAXUS_MAX_RETAIL_CHF",
    "GALAXUS_FASHION_ONLY",
    "GALAXUS_DEFAULT_SNEAKERS_ALL",
  ]) {
    delete process.env[k];
  }
});

describe("no guessed Sneakers category for non-footwear suppliers (Galaxus mail 2026-11-11)", () => {
  const nonShoe = [
    { providerKey: "HAW_194735293841", title: "Mattel HW Stunttrack Unendliche Crash-Aktion", brand: "Mattel" },
    { providerKey: "HAW_4012345678901", title: "Durex extra Safe 12Stk", brand: "Durex" },
    { providerKey: "ALT_5000394011111", title: "CR1616, Batterie", brand: "Duracell" },
    { providerKey: "VEN_5000394022222", title: "Duracell MN 27 - Batterie Alkaline", brand: "Duracell" },
    { providerKey: "EXL_3700000000001", title: "Tret-Traktor Claas Lader+Hänger 2-5 J.", brand: "Rolly Toys" },
  ];

  it("fallback kind is unknown for those suppliers, sneakers for footwear suppliers", () => {
    for (const s of ["haw", "alt", "ven", "exl", "bwz", "wrk", "fan", "bae"]) {
      expect(defaultGalaxusProductKind(s)).toBe("unknown");
    }
    for (const s of ["stx", "ner", "the", "gld", "nso"]) {
      expect(defaultGalaxusProductKind(s)).toBe("sneakers");
    }
    // Legacy callers without a supplier keep the old fallback.
    expect(defaultGalaxusProductKind(null)).toBe("sneakers");
  });

  it("blocks them as non_fashion (default policy: fashion only)", () => {
    for (const input of nonShoe) {
      expect(galaxusAssortmentBlockReason({ ...input, purchasePriceExVatChf: 20 })).toBe("non_fashion");
    }
  });

  it("keeps real footwear/apparel from any supplier (size or clothing word is evidence)", () => {
    expect(
      galaxusAssortmentBlockReason({ providerKey: "HAW_1", title: "Nike Air Max 90", brand: "Nike", sizeRaw: "42", purchasePriceExVatChf: 60 })
    ).not.toBe("non_fashion");
    expect(
      resolveGalaxusProductCategoryPath({ title: "Nike Air Max 90", brand: "Nike", sizeRaw: "42", supplierKey: "haw" })
    ).toBe(SNEAKERS);
    expect(
      galaxusAssortmentBlockReason({ providerKey: "HAW_2", title: "Hoodie Classic", brand: "Foo", purchasePriceExVatChf: 30 })
    ).not.toBe("non_fashion");
  });

  it("STX/NER mystery titles still default to sneakers and are not blocked", () => {
    for (const providerKey of ["STX_1", "NER_1"]) {
      expect(
        galaxusAssortmentBlockReason({ providerKey, title: "Jordan 1 Retro High OG Chicago", brand: "Jordan", sizeRaw: "10", purchasePriceExVatChf: 100 })
      ).toBeNull();
    }
    expect(resolveGalaxusProductCategoryPath({ title: "Mystery Colorway", supplierKey: "stx" })).toBe(SNEAKERS);
  });

  it("kill switch restores the old fallback", () => {
    process.env.GALAXUS_DEFAULT_SNEAKERS_ALL = "1";
    expect(defaultGalaxusProductKind("haw")).toBe("sneakers");
    expect(galaxusAssortmentBlockReason({ ...nonShoe[0], purchasePriceExVatChf: 20 })).not.toBe("non_fashion");
  });
});
