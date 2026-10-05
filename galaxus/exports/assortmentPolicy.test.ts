import { afterEach, describe, expect, it } from "vitest";
import {
  galaxusAssortmentBlockReason,
  galaxusAssortmentBlockReasonForCandidate,
} from "@/galaxus/exports/assortmentPolicy";

describe("galaxusAssortmentBlockReason", () => {
  afterEach(() => {
    delete process.env.GALAXUS_ASSORTMENT_POLICY;
    delete process.env.GALAXUS_SHOE_MAX_RETAIL_CHF;
  });

  it("blocks every REI row as electronics", () => {
    expect(galaxusAssortmentBlockReason({ providerKey: "REI_123", title: "Corsair Vengeance DDR5" })).toBe(
      "electronics"
    );
    expect(galaxusAssortmentBlockReason({ supplierVariantId: "rei_abc", title: "Anything" })).toBe("electronics");
  });

  it("blocks STX electronics by category", () => {
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_1",
        title: "Sony PlayStation 5 Console Disc Edition",
        brand: "Sony",
        suggestedRetailInclVatChf: 600,
      })
    ).toBe("electronics");
    expect(
      galaxusAssortmentBlockReason({ providerKey: "STX_2", title: "Apple AirPods Pro 2", suggestedRetailInclVatChf: 250 })
    ).toBe("electronics");
  });

  it("blocks general-release shoes above 300 CHF", () => {
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_3",
        title: "Nike Dunk Low Retro White Black Panda",
        brand: "Nike",
        sizeRaw: "EU 42",
        suggestedRetailInclVatChf: 320,
      })
    ).toBe("shoe_over_cap");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_4",
        title: "Nike Air Force 1 Low '07 White",
        brand: "Nike",
        sizeRaw: "US 10.5",
        suggestedRetailInclVatChf: 310,
      })
    ).toBe("shoe_over_cap");
  });

  it("keeps shoes at or under 300 CHF", () => {
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_5",
        title: "Nike Dunk Low Retro White Black Panda",
        sizeRaw: "EU 42",
        suggestedRetailInclVatChf: 299,
      })
    ).toBeNull();
  });

  it("keeps collab / hype shoes above 300 CHF", () => {
    for (const title of [
      "Nike Air Jordan 1 Retro High Off-White Chicago",
      "Jordan 1 Retro Low OG SP Travis Scott Reverse Mocha",
      "Nike SB Dunk Low Ben & Jerry's Chunky Dunky",
      "Nike Dunk Low Off-White Lot 50",
      "Nike Air Force 1 Low Supreme White",
      "Nike Dunk Low Union Passport Pack",
    ]) {
      expect(
        galaxusAssortmentBlockReason({ providerKey: "STX_6", title, sizeRaw: "EU 43", suggestedRetailInclVatChf: 900 })
      ).toBeNull();
    }
  });

  it("estimates consumer price from purchase price when no SRP (NER)", () => {
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "NER_1",
        title: "Nike Air Max 95 OG Neon",
        sizeRaw: "42",
        purchasePriceExVatChf: 230,
      })
    ).toBe("shoe_over_cap");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "NER_2",
        title: "Nike Air Max 95 OG Neon",
        sizeRaw: "42",
        purchasePriceExVatChf: 150,
      })
    ).toBeNull();
  });

  it("keeps LEGO and collectibles above 300 CHF", () => {
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_7",
        title: "LEGO Star Wars Millennium Falcon Set 75192",
        brand: "LEGO",
        suggestedRetailInclVatChf: 1100,
      })
    ).toBeNull();
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_8",
        title: "KAWS Companion Open Edition Vinyl Figure Black",
        brand: "KAWS",
        suggestedRetailInclVatChf: 450,
      })
    ).toBeNull();
  });

  it("blocks absurd prices (absolute cap or far above brand retail)", () => {
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_9",
        title: "2019 Pokemon Sun & Moon Team Up Booster Box",
        suggestedRetailInclVatChf: 36179,
      })
    ).toBe("price_outlier");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_10",
        title: "Hot Wheels Super Treasure Hunt 2021 Mazda",
        suggestedRetailInclVatChf: 339,
        brandRetailPrice: 2,
      })
    ).toBe("price_outlier");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_11",
        title: "Nike SB Dunk Low White Lobster (Friends and Family)",
        sizeRaw: "EU 42",
        suggestedRetailInclVatChf: 23569,
        brandRetailPrice: 110,
      })
    ).toBe("price_outlier");
  });

  it("does not treat non-shoes from other suppliers as footwear", () => {
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "BWZ_1",
        title: "Kombikinderwagen Fame Travel-Set inkl. Babyschale Pebble Slide Pro",
        purchasePriceExVatChf: 1888,
      })
    ).toBeNull();
    expect(
      galaxusAssortmentBlockReason({ providerKey: "EXL_1", title: "Kuh Spezial Red-Holstein", purchasePriceExVatChf: 315 })
    ).toBeNull();
  });

  it("only applies the price-outlier rule to StockX", () => {
    expect(
      galaxusAssortmentBlockReason({ providerKey: "BWZ_2", title: "Ecksofa Leder Cognac", purchasePriceExVatChf: 6000 })
    ).toBeNull();
  });

  it("keeps apparel regardless of price", () => {
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_12",
        title: "Supreme Box Logo Hooded Sweatshirt Black",
        sizeRaw: "L",
        suggestedRetailInclVatChf: 700,
      })
    ).toBeNull();
  });

  it("respects the kill switch and cap env", () => {
    process.env.GALAXUS_ASSORTMENT_POLICY = "0";
    expect(galaxusAssortmentBlockReason({ providerKey: "REI_1" })).toBeNull();
    delete process.env.GALAXUS_ASSORTMENT_POLICY;
    process.env.GALAXUS_SHOE_MAX_RETAIL_CHF = "400";
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_13",
        title: "Nike Dunk Low Panda",
        sizeRaw: "EU 42",
        suggestedRetailInclVatChf: 350,
      })
    ).toBeNull();
  });
});

describe("galaxusAssortmentBlockReasonForCandidate", () => {
  it("reads variant + kickdb product fields from a feed candidate", () => {
    expect(
      galaxusAssortmentBlockReasonForCandidate({
        providerKey: "STX_14",
        sellPriceExVat: 260,
        mapping: { supplierKey: "stx" },
        variant: {
          supplierVariantId: "stx_abc",
          supplierProductName: "Nike Dunk Low Retro Grey Fog",
          supplierBrand: "Nike",
          sizeRaw: "EU 44",
          suggestedRetailPriceInclVat: "349.00",
        },
        product: { name: "Nike Dunk Low Retro Grey Fog", retailPrice: 115 },
      })
    ).toBe("shoe_over_cap");
  });
});
