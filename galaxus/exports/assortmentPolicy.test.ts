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
    delete process.env.GALAXUS_PRICE_OUTLIER_FILTER;
  });

  it("blocks REI storage / IT components but keeps other REI products", () => {
    expect(galaxusAssortmentBlockReason({ providerKey: "REI_123", title: "Corsair Vengeance DDR4" })).toBe(
      "electronics"
    );
    expect(galaxusAssortmentBlockReason({ supplierVariantId: "rei_abc", title: "Lötstation 80 W" })).toBeNull();
  });

  it("keeps electronics that are not storage or IT components", () => {
    for (const input of [
      { providerKey: "STX_1", title: "Sony PlayStation 5 Console Disc Edition", brand: "Sony", suggestedRetailInclVatChf: 600 },
      { providerKey: "STX_2", title: "Apple AirPods Pro 2", suggestedRetailInclVatChf: 250 },
      { providerKey: "HAW_9", title: "Philips Hue White E27 LED Lampe", purchasePriceExVatChf: 20 },
      { providerKey: "ALT_9", title: "Logitech MX Keys Tastatur", purchasePriceExVatChf: 90 },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).toBeNull();
    }
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
      { providerKey: "BWZ_3", title: "Kingston Fury Beast 32GB DDR4 RAM", brand: "Kingston" },
      { providerKey: "VEN_4", title: "USB-Stick 64 GB" },
      { providerKey: "HAW_5", title: "Seagate Expansion Desktop Festplatte 8TB", brand: "Seagate" },
      { providerKey: "ALT_6", title: "MSI GeForce RTX 4070 Ventus Grafikkarte" },
      { providerKey: "REI_7", title: "INTEL Intel Core i3-14100F, 3.5 GHz, en boîte, 1700", brand: "INTEL" },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).toBe("electronics");
    }
  });

  it("keeps Nvidia, DDR5, SO-DIMM and Raspberry Pi items", () => {
    for (const input of [
      { providerKey: "STX_7", title: "Nvidia Jetson Orin Nano Developer Kit", brand: "Nvidia" },
      { providerKey: "REI_8", title: "PNY NVIDIA RTX A2000 12GB", brand: "PNY" },
      { providerKey: "REI_9", title: "CSX DIMM DDR5-5600MHZ 8 GO CSX, CL46", brand: "CSX" },
      { providerKey: "REI_10", title: "Kingston Fury Beast 32GB DDR5 RAM", brand: "Kingston" },
      { providerKey: "REI_11", title: "CSX SODIMM CSX 2 GO DDR3-1600MHZ", brand: "CSX" },
      { providerKey: "REI_12", title: "RASPBERRY PI Raspberry Pi Compute Modul 5, 2GB RAM, sans eMMC", brand: "RASPBERRY PI" },
      { providerKey: "REI_13", title: "KKSB Boîtier pour Raspberry Pi 5 & M.2 NVMe HAT", brand: "KKSB" },
      { providerKey: "REI_14", title: "AKASA Gehäuse für Raspberry Pi 4, Alu, schwarz", brand: "AKASA" },
      { providerKey: "REI_15", title: "RASPBERRY PI Netzteil USB-C 27 W für Raspberry Pi 5, weiss", brand: "RASPBERRY PI" },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).toBeNull();
    }
  });

  it("blocks long items that are expensive to ship", () => {
    for (const input of [
      { providerKey: "REI_20", title: "PHILIPS Tube LED, T8, 22,1 W, 4100 lm, 4000 K, 1500 mm" },
      { providerKey: "REI_21", title: "LEDVANCE GMBH Tube LED 15 W 1800 lm, 6500 K, 1,2 M." },
      { providerKey: "REI_22", title: "OSRAM Leuchtstoffröhre T5, 28 W, 1149 mm" },
      { providerKey: "REI_23", title: "PAULMANN LED-Streifen MaxLED, 18 W, 630 lm, RGBW, 1500 mm, dimmbar" },
      { providerKey: "REI_24", title: "PAULMANN Strip MaxLED 250 1m RGBW IP44 Protect Cover 7W 230/24V Argent" },
      { providerKey: "REI_25", title: "Alu-Profil für LED-Streifen, 2 m, eloxiert" },
      { providerKey: "REI_26", title: "PHOENIX CONTACT Tragschiene NS 35, 2000 mm" },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).toBe("bulky_shipping");
    }
  });

  it("blocks gift cards from any supplier", () => {
    expect(galaxusAssortmentBlockReason({ providerKey: "BWZ_40", title: "baby-walz Geschenkkarte 50 CHF" })).toBe("gift_card");
    expect(galaxusAssortmentBlockReason({ providerKey: "EXL_41", title: "Ex Libris Gutschein 20.-" })).toBe("gift_card");
  });

  it("blocks BWZ rows that are unshippable or expensive without a parcel class", () => {
    const standard = JSON.stringify({ parcelClass: "standard", shipChf: 12 });
    const unknown = JSON.stringify({ parcelClass: "unknown", shipChf: null });
    const unshippable = JSON.stringify({ parcelClass: "unshippable" });
    expect(
      galaxusAssortmentBlockReason({ providerKey: "BWZ_42", title: "Kinderwagen Duo", purchasePriceExVatChf: 450, manualNote: standard })
    ).toBeNull();
    expect(
      galaxusAssortmentBlockReason({ providerKey: "BWZ_43", title: "Kinderwagen Duo", purchasePriceExVatChf: 450, manualNote: unknown })
    ).toBe("bulky_shipping");
    expect(
      galaxusAssortmentBlockReason({ providerKey: "BWZ_44", title: "Kinderwagen Duo", purchasePriceExVatChf: 450 })
    ).toBe("bulky_shipping");
    expect(
      galaxusAssortmentBlockReason({ providerKey: "BWZ_45", title: "Schnuller 2er Pack", purchasePriceExVatChf: 12, manualNote: unknown })
    ).toBeNull();
    expect(
      galaxusAssortmentBlockReason({ providerKey: "BWZ_46", title: "Gitterbett", purchasePriceExVatChf: 50, manualNote: unshippable })
    ).toBe("bulky_shipping");
    expect(
      galaxusAssortmentBlockReason({ providerKey: "HAW_47", title: "Rasenmäher", purchasePriceExVatChf: 450 })
    ).toBeNull();
  });

  it("does not treat short items, colours or coiled cables as bulky", () => {
    for (const input of [
      { providerKey: "REI_30", title: "NEUTRIK XLR-Codierring, Markierungsring, Neon-rot" },
      { providerKey: "REI_31", title: "AVERY ZWECKFORM Warnetiketten, 7211, 100x50mm, neonrot" },
      { providerKey: "REI_32", title: "HAMMOND MANUFACTURING Profilgehäuse, 1455 N, 120 x 103 x 53 mm, silber" },
      { providerKey: "REI_33", title: "DELOCK Câble HDMI 2.1, 5 m, noir" },
      { providerKey: "REI_34", title: "FREI Support pour la série Shelly Mini, rail DIN" },
      { providerKey: "REI_35", title: "VERBATIM Clé USB 3.0 64 Go Verbatim PinStripe noire" },
      { providerKey: "REI_36", title: "BRENNENSTUHL Premium-Line Steckdosenleiste, 6-fach, USB, 3 m Kabel, schwarz" },
      { providerKey: "REI_37", title: "PANORAMA ANTENNAS Antenne tige 2x2 4G/5G/450 MHz 0,5 m, connecteur N" },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).not.toBe("bulky_shipping");
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

  it("keeps absurd StockX prices unless GALAXUS_PRICE_OUTLIER_FILTER=1", () => {
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_9",
        title: "2019 Pokemon Sun & Moon Team Up Booster Box",
        suggestedRetailInclVatChf: 36179,
      })
    ).toBeNull();
  });

  it("blocks absurd prices when the outlier filter is on", () => {
    process.env.GALAXUS_PRICE_OUTLIER_FILTER = "1";
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
    ).not.toBe("shoe_over_cap");
    expect(
      galaxusAssortmentBlockReason({ providerKey: "EXL_1", title: "Kuh Spezial Red-Holstein", purchasePriceExVatChf: 315 })
    ).toBeNull();
  });

  it("only applies the price-outlier rule to StockX", () => {
    process.env.GALAXUS_PRICE_OUTLIER_FILTER = "1";
    expect(
      galaxusAssortmentBlockReason({ providerKey: "HAW_2", title: "Ecksofa Leder Cognac", purchasePriceExVatChf: 6000 })
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
    expect(galaxusAssortmentBlockReason({ providerKey: "REI_1", title: "Samsung 990 PRO SSD 2TB" })).toBeNull();
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
