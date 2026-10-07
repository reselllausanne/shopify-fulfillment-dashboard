import { afterEach, describe, expect, it } from "vitest";
import {
  galaxusAssortmentBlockReason,
  galaxusAssortmentBlockReasonForCandidate,
} from "@/galaxus/exports/assortmentPolicy";

describe("galaxusAssortmentBlockReason", () => {
  afterEach(() => {
    delete process.env.GALAXUS_ASSORTMENT_POLICY;
    delete process.env.GALAXUS_SHOE_MAX_RETAIL_CHF;
    delete process.env.GALAXUS_SHOE_CAP_SCOPE;
    delete process.env.GALAXUS_SHOE_CAP_COLLAB_EXEMPT;
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

  const collabTitles = [
    "Nike Air Jordan 1 Retro High Off-White Chicago",
    "Jordan 1 Retro Low OG SP Travis Scott Reverse Mocha",
    "Nike SB Dunk Low Ben & Jerry's Chunky Dunky",
    "Nike Dunk Low Off-White Lot 50",
  ];

  it("blocks focus-brand collabs above 300 CHF by default (no collab exemption for now)", () => {
    for (const title of collabTitles) {
      expect(
        galaxusAssortmentBlockReason({ providerKey: "STX_6", title, sizeRaw: "EU 43", suggestedRetailInclVatChf: 900 })
      ).toBe("shoe_over_cap");
    }
  });

  it("keeps focus-brand collabs when GALAXUS_SHOE_CAP_COLLAB_EXEMPT=1", () => {
    process.env.GALAXUS_SHOE_CAP_COLLAB_EXEMPT = "1";
    for (const title of collabTitles) {
      expect(
        galaxusAssortmentBlockReason({ providerKey: "STX_6", title, sizeRaw: "EU 43", suggestedRetailInclVatChf: 900 })
      ).toBeNull();
    }
  });

  it("keeps non-focus-brand shoes above 300 CHF unless scope=all", () => {
    const input = {
      providerKey: "STX_15",
      title: "adidas Yeezy Boost 350 V2 Zebra",
      brand: "adidas",
      sizeRaw: "EU 42",
      suggestedRetailInclVatChf: 420,
    };
    expect(galaxusAssortmentBlockReason(input)).toBeNull();
    process.env.GALAXUS_SHOE_CAP_SCOPE = "all";
    expect(galaxusAssortmentBlockReason(input)).toBe("shoe_over_cap");
  });

  it("treats focus brand from the brand field even when the title has no brand word", () => {
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "NER_3",
        title: "Endorphin Pro 5 Vizired / Black",
        brand: "Saucony",
        sizeRaw: "46",
        purchasePriceExVatChf: 305,
      })
    ).toBe("shoe_over_cap");
  });

  it("blocks storage media and IT components from any supplier", () => {
    for (const input of [
      { providerKey: "HAW_1", title: "Samsung 990 PRO NVMe M.2 SSD 2TB" },
      { providerKey: "EXL_2", title: "SanDisk Extreme microSDXC 256 GB", brand: "SanDisk" },
      { providerKey: "BWZ_3", title: "Kingston Fury Beast 32GB DDR5 RAM", brand: "Kingston" },
      { providerKey: "VEN_4", title: "USB-Stick 64 GB" },
      { providerKey: "HAW_5", title: "Seagate Expansion Desktop Festplatte 8TB", brand: "Seagate" },
      { providerKey: "ALT_6", title: "MSI GeForce RTX 4070 Ventus Grafikkarte" },
      { providerKey: "STX_7", title: "Nvidia Jetson Orin Nano Developer Kit", brand: "Nvidia" },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).toBe("electronics");
    }
  });

  it("does not flag dry-run false positives as electronics", () => {
    for (const input of [
      { providerKey: "STX_18", title: "Nike Adapt BB 2.0 Tie Dye (US Charger)", brand: "Nike", sizeRaw: "EU 44", suggestedRetailInclVatChf: 280 },
      { providerKey: "STX_19", title: "Nike Air Max 90 Xbox x EA Sports Madden 20", brand: "Nike", sizeRaw: "EU 43", suggestedRetailInclVatChf: 250 },
      { providerKey: "NER_4", title: "Maillot Manches Longues Kenny Charger Blanc/Rose Femme", brand: "Kenny", sizeRaw: "M", purchasePriceExVatChf: 40 },
      { providerKey: "NER_5", title: "Cartouche RockShox Charger 2.1 RCT3 Pike 29''", brand: "RockShox", purchasePriceExVatChf: 200 },
      { providerKey: "NER_6", title: "Porte Bidon Massi IOS Noir / Blanc", brand: "Massi", purchasePriceExVatChf: 10 },
      { providerKey: "EXL_3", title: "RAM 2500 Feuerwehreinsatzwagen mit L+S", brand: "Spielfahrzeuge", purchasePriceExVatChf: 30 },
      { providerKey: "EXL_4", title: "Happy People 77712 - Wehncke, 3-Ring Pool, 157x28cm", purchasePriceExVatChf: 15 },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).not.toBe("electronics");
    }
  });

  it("does not flag ordinary products with IT-looking words", () => {
    expect(galaxusAssortmentBlockReason({ providerKey: "STX_16", title: "Ram Trucks Hot Wheels 2021", suggestedRetailInclVatChf: 20 })).toBeNull();
    expect(
      galaxusAssortmentBlockReason({ providerKey: "STX_17", title: "Nike Air Force 1 Low White", sizeRaw: "EU 42", suggestedRetailInclVatChf: 150 })
    ).toBeNull();
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
