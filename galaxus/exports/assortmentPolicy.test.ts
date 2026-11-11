import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildStxSizePriceMedianIndex,
  galaxusAssortmentBlockReason,
  galaxusAssortmentBlockReasonForCandidate,
  galaxusDisabledSuppliers,
} from "@/galaxus/exports/assortmentPolicy";

describe("galaxusAssortmentBlockReason", () => {
  beforeEach(() => {
    process.env.GALAXUS_REI_ALLOWLIST = "0";
    process.env.GALAXUS_FASHION_ONLY = "0";
    process.env.GALAXUS_NER_APPAREL_ONLY = "0";
    process.env.GALAXUS_DISABLED_SUPPLIERS = "";
    // Isolate shoe / electronics cases from the 300 CHF default cap.
    process.env.GALAXUS_MAX_RETAIL_CHF = "5000";
  });

  afterEach(() => {
    delete process.env.GALAXUS_REI_ALLOWLIST;
    delete process.env.GALAXUS_FASHION_ONLY;
    delete process.env.GALAXUS_NER_APPAREL_ONLY;
    delete process.env.GALAXUS_DISABLED_SUPPLIERS;
    delete process.env.GALAXUS_ASSORTMENT_POLICY;
    delete process.env.GALAXUS_SHOE_MAX_RETAIL_CHF;
    delete process.env.GALAXUS_SHOE_CAP_SCOPE;
    delete process.env.GALAXUS_SHOE_CAP_COLLAB_EXEMPT;
    delete process.env.GALAXUS_PRICE_OUTLIER_FILTER;
    delete process.env.GALAXUS_MAX_RETAIL_CHF;
  });

  it("blocks REI storage / IT components but keeps other REI products", () => {
    expect(galaxusAssortmentBlockReason({ providerKey: "REI_123", title: "Corsair Vengeance DDR4" })).toBe(
      "electronics"
    );
    expect(galaxusAssortmentBlockReason({ supplierVariantId: "rei_abc", title: "Lötstation 80 W" })).toBeNull();
  });

  it("delists REI outside the allowlist", () => {
    delete process.env.GALAXUS_REI_ALLOWLIST;
    expect(galaxusAssortmentBlockReason({ providerKey: "REI_123", title: "Lötstation 80 W" })).toBe(
      "rei_not_allowlisted"
    );
    expect(galaxusAssortmentBlockReason({ providerKey: "rei_7350001162034", title: "Kksb HAT Case Raspberry Pi 5" })).toBeNull();
    expect(
      galaxusAssortmentBlockReasonForCandidate({
        gtin: "0840006674900",
        variant: { supplierVariantId: "rei_ABC", supplierProductName: "Corsair Vengeance DDR5 2x16GB" },
      })
    ).toBeNull();
    expect(galaxusAssortmentBlockReason({ providerKey: "REI_4013674035441", title: "Ansmann NiMH AA" })).toBe(
      "rei_not_allowlisted"
    );
    expect(galaxusAssortmentBlockReason({ providerKey: "REI_8720169316751", title: "Philips Master LED tube" })).toBe(
      "rei_not_allowlisted"
    );
    expect(galaxusAssortmentBlockReason({ providerKey: "REI_4021553335377", title: "Barthelme Telefonstecklampe" })).toBeNull();
    expect(
      galaxusAssortmentBlockReason({ providerKey: "REI_4250312512913", title: "CSX DIMM DDR4-2400MHZ 8 GO CSX", brand: "CSX" })
    ).toBeNull();
    expect(galaxusAssortmentBlockReason({ providerKey: "STX_1", title: "Nike Dunk Low", sizeRaw: "42" })).toBeNull();
  });

  it("fashion-only: delists non-fashion + LEGO/TCG/controller, keeps fashion, console, REI allowlist", () => {
    delete process.env.GALAXUS_FASHION_ONLY;
    delete process.env.GALAXUS_REI_ALLOWLIST;
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_2",
        title: "Apple AirPods Pro 2",
        suggestedRetailInclVatChf: 250,
      })
    ).toBe("non_fashion");
    // SM product-type list also catches these (title / path leaf).
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_3",
        title: "Supreme Skateboard Deck",
        brand: "Supreme",
        suggestedRetailInclVatChf: 150,
      })
    ).toBe("product_type_block");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_4",
        title: "Stanley Quencher 40oz Tumbler Rose",
        suggestedRetailInclVatChf: 80,
      })
    ).toBe("product_type_block");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_12",
        title: "LEGO Star Wars Millennium Falcon 75192",
        brand: "LEGO",
        suggestedRetailInclVatChf: 200,
      })
    ).toBe("lego");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_13",
        title: "Pokemon TCG Scarlet & Violet Booster Box",
        brand: "Pokemon",
        suggestedRetailInclVatChf: 200,
      })
    ).toBe("hobby_toy");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_5",
        title: "Sony PS5 DualSense Wireless Controller Sterling Silver",
        brand: "Sony",
        suggestedRetailInclVatChf: 90,
      })
    ).toBe("hobby_toy");
    for (const input of [
      { providerKey: "STX_1", title: "Sony PlayStation 5 Console Disc Edition", brand: "Sony", suggestedRetailInclVatChf: 600 },
      { providerKey: "STX_041604418976", title: "Stanley Chocolate Flowstate Quencher 40oz Tumbler", suggestedRetailInclVatChf: 80 },
      { providerKey: "STX_10", title: "Nike Dunk Low Panda", brand: "Nike", sizeRaw: "42", suggestedRetailInclVatChf: 150 },
      { providerKey: "STX_11", title: "Essentials Fleece Hoodie Black", brand: "Fear of God", sizeRaw: "M", suggestedRetailInclVatChf: 120 },
      { providerKey: "REI_7350001162034", title: "Kksb HAT Case Raspberry Pi 5" },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).toBeNull();
    }
  });

  it("blocks Galaxus product types from SM remove xlsx (path / supplierProductType / long title)", () => {
    process.env.GALAXUS_FASHION_ONLY = "0";
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_PT1",
        title: "Random Widget",
        supplierProductType: "Smartphone Hülle",
        suggestedRetailInclVatChf: 25,
      })
    ).toBe("product_type_block");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_PT2",
        title: "Apple Watch Series 10 GPS",
        brand: "Apple",
        supplierProductType: "Smartwatch",
        suggestedRetailInclVatChf: 400,
      })
    ).toBe("product_type_block");
    // Overlap with hobby_toy kinds → hobby_toy wins (reason order).
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_PT3",
        title: "Catan Board Game",
        brand: "Catan",
        supplierProductType: "Brettspiele",
        suggestedRetailInclVatChf: 50,
      })
    ).toBe("hobby_toy");
    // Sneakers stay (not in SM product-type remove list).
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_PT_OK",
        title: "Nike Dunk Low Panda",
        brand: "Nike",
        sizeRaw: "42",
        suggestedRetailInclVatChf: 150,
      })
    ).toBeNull();
  });

  it("blocks hobby toys even when fashion-only is off (STX sneakers misclass hole)", () => {
    process.env.GALAXUS_FASHION_ONLY = "0";
    for (const input of [
      { providerKey: "STX_H1", title: "Fidget Spinner Metal Rainbow", suggestedRetailInclVatChf: 15 },
      { providerKey: "STX_H2", title: "Squishmallow Cat 12 inch", brand: "Squishmallows", suggestedRetailInclVatChf: 40 },
      { providerKey: "STX_H3", title: "Barbie Dreamhouse Doll", brand: "Mattel", suggestedRetailInclVatChf: 80 },
      { providerKey: "STX_H4", title: "Bike Basket Front Wire", suggestedRetailInclVatChf: 35 },
      { providerKey: "STX_H5", title: "PS5 Console Cover Gray Camouflage", brand: "Sony", suggestedRetailInclVatChf: 40 },
      { providerKey: "STX_H6", title: "Abbey Road Vinyl Record", brand: "Beatles", suggestedRetailInclVatChf: 35 },
      { providerKey: "STX_H7", title: "Smith Ski Helmet Black", brand: "Smith", suggestedRetailInclVatChf: 120 },
      { providerKey: "STX_H8", title: "Lindt Advent Calendar Chocolate", brand: "Lindt", suggestedRetailInclVatChf: 25 },
      { providerKey: "STX_H9", title: "Harry Potter Book Hardcover", brand: "Bloomsbury", suggestedRetailInclVatChf: 30 },
      { providerKey: "STX_H10", title: "Leather Keyholder Brown", suggestedRetailInclVatChf: 20 },
      { providerKey: "STX_H11", title: "Warhammer 40k Miniature Game Set", brand: "Games Workshop", suggestedRetailInclVatChf: 90 },
      { providerKey: "STX_H12", title: "Catan Board Game", brand: "Catan", suggestedRetailInclVatChf: 50 },
      { providerKey: "STX_H13", title: "Set of Polyhedral Dice", suggestedRetailInclVatChf: 12 },
      { providerKey: "STX_H14", title: "ROG Harpe Ace Gaming Mouse", brand: "ASUS", suggestedRetailInclVatChf: 80 },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).toBe("hobby_toy");
    }
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_H15",
        title: "Victorinox Swiss Army Knife Classic SD",
        brand: "Victorinox",
        suggestedRetailInclVatChf: 35,
      })
    ).toBe("hobby_toy");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "HAW_KNIFE",
        title: "CORVUS Kids at Work Taschenmesser",
        brand: "Corvus",
        purchasePriceExVatChf: 12,
      })
    ).toBe("hobby_toy");
    // Fashion collabs stay.
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_PKM_SHOE",
        title: "adidas Samba OG Pokémon Mewtwo",
        brand: "adidas",
        sizeRaw: "42",
        suggestedRetailInclVatChf: 150,
      })
    ).toBeNull();
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_DOLL_COLOR",
        title: "Nike Vomero 18 Sail Doll Beyond Pink",
        brand: "Nike",
        sizeRaw: "42",
        suggestedRetailInclVatChf: 160,
      })
    ).toBeNull();
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_POCKET_KNIFE_SHOE",
        title: "Nike Pocket Knife DM Black Hot Punch",
        brand: "Nike",
        sizeRaw: "42",
        suggestedRetailInclVatChf: 180,
      })
    ).toBeNull();
  });

  it("delists every WellPlayed row by default", () => {
    delete process.env.GALAXUS_DISABLED_SUPPLIERS;
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "WEL_1",
        title: "Catan Basisspiel",
        supplierProductType: "Board Games",
        purchasePriceExVatChf: 30,
      })
    ).toBe("supplier_disabled");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "WEL_NEW_GAME",
        title: "Catan: 6th Edition",
        brand: "Catan Studios",
        supplierKey: "wel",
        suggestedRetailInclVatChf: 40,
      })
    ).toBe("supplier_disabled");
  });

  it("blocks all LEGO sets (temp delist 2026-11-09), even with fashion-only off", () => {
    process.env.GALAXUS_FASHION_ONLY = "0";
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_7b",
        title: "LEGO Star Wars Advent Calendar Set 75340",
        brand: "LEGO",
        suggestedRetailInclVatChf: 96,
      })
    ).toBe("lego");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_adidas_lego",
        title: "adidas Ultra Boost LEGO Color Pack Blue",
        brand: "Adidas",
        sizeRaw: "42",
        suggestedRetailInclVatChf: 200,
      })
    ).toBeNull();
  });

  it("blocks manually listed rows", () => {
    expect(
      galaxusAssortmentBlockReason({ providerKey: "stx_4560157584359", title: "Takashi Murakami Flower Plush 30CM" })
    ).toBe("manual_block");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_0888977784846",
        title: "Supreme Hanes Boxer Briefs (4 Pack) White",
        sizeRaw: "XXL",
        supplierKey: "stx",
      })
    ).toBe("manual_block");
  });

  it("blocks soft toys / Jellycat plush (Tali 2026-10-27)", () => {
    // fashion-only off — plush must still delist (was the sneakers-default hole).
    process.env.GALAXUS_FASHION_ONLY = "0";
    // Complained SKUs are also on the manual blocklist.
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_670983164428",
        title: "Jellycat Bashful Bunny 'Snow Suit' Plush",
        brand: "Jellycat",
        suggestedRetailInclVatChf: 229,
        supplierKey: "stx",
      })
    ).toBe("manual_block");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_670983109511",
        title: "Jellycat Amuseables Cloud Plush",
        brand: "Jellycat",
        suggestedRetailInclVatChf: 209,
        supplierKey: "stx",
      })
    ).toBe("manual_block");
    // Durable rule: new catalog rows (title / Jellycat brand), no manual key needed.
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_NEW_PLUSH",
        title: "Some Brand Bunny Plush 30cm",
        brand: "Other",
        suggestedRetailInclVatChf: 80,
        supplierKey: "stx",
      })
    ).toBe("plush");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_NEW_JELLY",
        title: "Amuseables Something Soft",
        brand: "Jellycat",
        suggestedRetailInclVatChf: 120,
        supplierKey: "stx",
      })
    ).toBe("plush");
    // Hard art toys / sneakers stay.
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_BEAR",
        title: "Medicom Toy BE@RBRICK 1000%",
        brand: "Bearbrick",
        suggestedRetailInclVatChf: 800,
        supplierKey: "stx",
      })
    ).toBeNull();
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_1",
        title: "Nike Dunk Low Panda",
        brand: "Nike",
        sizeRaw: "42",
        suggestedRetailInclVatChf: 150,
      })
    ).toBeNull();
  });

  it("delists every Baby-Walz row by default", () => {
    delete process.env.GALAXUS_DISABLED_SUPPLIERS;
    expect(
      galaxusAssortmentBlockReason({ providerKey: "BWZ_1", title: "2er-Pack Bodys langarm", sizeRaw: "62/68" })
    ).toBe("supplier_disabled");
    expect(galaxusAssortmentBlockReason({ providerKey: "STX_1", title: "Nike Dunk Low", sizeRaw: "42" })).toBeNull();
  });

  it("delists every Ex Libris (EXL) row by default", () => {
    delete process.env.GALAXUS_DISABLED_SUPPLIERS;
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "EXL_123",
        supplierVariantId: "exl_123",
        title: "Random book",
        brand: "Ex Libris",
      })
    ).toBe("supplier_disabled");
    expect(galaxusDisabledSuppliers().has("exl")).toBe(true);
  });

  it("delists every REI row by default except the Jetson", () => {
    delete process.env.GALAXUS_DISABLED_SUPPLIERS;
    delete process.env.GALAXUS_REI_ALLOWLIST;
    expect(
      galaxusAssortmentBlockReason({ providerKey: "REI_8", title: "PNY NVIDIA RTX A2000 12GB", brand: "PNY" })
    ).toBe("supplier_disabled");
    expect(
      galaxusAssortmentBlockReason({ providerKey: "REI_7350001162034", title: "Kksb HAT Case Raspberry Pi 5" })
    ).toBe("supplier_disabled");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "REI_0812674025278",
        gtin: "0812674025278",
        title: "NVIDIA Kit NVIDIA Jetson Orin Nano Super Dev., 67 TOPS, 8 Go DDR5",
        brand: "NVIDIA",
        purchasePriceExVatChf: 599,
      })
    ).toBeNull();
  });

  it("delists former BWZ Lansinoh trial SKUs after Monday rollback", () => {
    delete process.env.GALAXUS_DISABLED_SUPPLIERS;
    delete process.env.GALAXUS_FASHION_ONLY;
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "BWZ_5060420232721",
        title: "Lansinoh Intim-Dusche",
        suggestedRetailInclVatChf: 20,
      })
    ).toBe("supplier_disabled");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "BWZ_5060420233353",
        title: "Lansinoh HPA Lanolin cream",
        suggestedRetailInclVatChf: 20,
      })
    ).toBe("category_block");
  });

  it("NER: keeps clothing and shoes only", () => {
    delete process.env.GALAXUS_NER_APPAREL_ONLY;
    for (const input of [
      { providerKey: "NER_1", title: "Veja V-90 - White / Black", sizeRaw: "46" },
      { providerKey: "NER_2", title: "Salomon XT-6", sizeRaw: "42 2/3" },
      { providerKey: "NER_3", title: "Chaussures Homme ASICS SONICBLAST 2", sizeRaw: "41 1/2" },
      { providerKey: "NER_4", title: "Maillot Manches Courtes Fox Flexair Pro Vert", sizeRaw: "L" },
      { providerKey: "NER_5", title: "Gants Longs Fox Defend Noir", sizeRaw: "XL" },
      { providerKey: "NER_6", title: "Casquette Unisexe Buff Pack Speed Noir", sizeRaw: "S/M" },
      { providerKey: "NER_7", title: "Haut Femme adidas adi365 Manches Longues", sizeRaw: "M" },
      { providerKey: "NER_8", title: "Chaussures Pédales Plates Fox Union Noir", sizeRaw: "42" },
      { providerKey: "NER_9", title: "Brassière Nike Swift High Support Noir Femme", sizeRaw: "M" },
      { providerKey: "NER_14", title: "Lunettes POC Elicit Noir", sizeRaw: "OS" },
      { providerKey: "NER_13", title: "Sac à Dos Columbia Landroamer 24L Noir", sizeRaw: "OS" },
      { providerKey: "NER_18", title: "Sac de Randonnée Salewa Alp Trainer 25L Bleu", sizeRaw: "OS" },
      { providerKey: "NER_30", title: "Sac à Dos The North Face Base Camp Fuse Box 30L Noir", sizeRaw: "OS" },
      { providerKey: "NER_31", title: "Sac de Voyage Patagonia Black Hole Duffel 70L Gris", sizeRaw: "OS" },
      { providerKey: "NER_32", title: "Lunettes Julbo Shield Reactiv 0-4 Noir/Bordeaux", sizeRaw: "OS" },
      { providerKey: "NER_33", title: "Verres de remplacement Oakley Sutro | Prizm 24K | Ref.103-121-011", sizeRaw: "OS" },
      { providerKey: "NER_34", title: "Bracelet de Montre Suunto Athletic 6 Silicone 22mm S+M Noir", sizeRaw: "OS" },
      { providerKey: "NER_35", title: "Bracelet Nylon Garmin UltraFit 22 mm Noir", sizeRaw: "21" },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).not.toBe("ner_not_apparel");
    }
    for (const input of [
      { providerKey: "NER_10", title: "Casque Intégral Fox Proframe RS Aura Blanc/Noir", sizeRaw: "M(55-59CM)" },
      { providerKey: "NER_11", title: "Chaîne BBB FlatLine 12V Argent", sizeRaw: "90" },
      { providerKey: "NER_12", title: "Plateau Spécialités TA Alizé Extérieur 130mm", sizeRaw: "48" },
      { providerKey: "NER_15", title: "Spray Imperméabilisant Vêtements Muc-Off 250ml", sizeRaw: "OS" },
      { providerKey: "NER_16", title: "Visière Magnétique Kask Bambino Pro Transparente", sizeRaw: "OS" },
      { providerKey: "NER_17", title: "Selle Prologo Dimension AGX Slide Control Nack Noir", sizeRaw: "OS" },
      { providerKey: "NER_19", title: "RACE FACE Paire de Protèges Manivelles Alu BOOT PEDAL Rouge", sizeRaw: "OS" },
      { providerKey: "NER_20", title: "Sabot Protection Moteur AVS pour Lapierre GLP2", sizeRaw: "OS" },
      { providerKey: "NER_21", title: "Coque de Protection Quad Lock MAG Poncho pour iPhone 15 Pro Max", sizeRaw: "OS" },
      { providerKey: "NER_22", title: "Lot Pneus VTT Hutchinson Python 2 29'' Tubeless Ready", sizeRaw: "OS" },
      { providerKey: "NER_23", title: "Home Trainer Wahoo Fitness Kickr Core v2", sizeRaw: "OS" },
      { providerKey: "NER_24", title: "Gilet de Protection Leatt ReaFlex Stealth Noir", sizeRaw: "M" },
      { providerKey: "NER_25", title: "Bandeau de Rechange Petzl Swift RL Noir/Orange", sizeRaw: "OS" },
      { providerKey: "NER_26", title: "Sacoche de Porte-Bagages Ortlieb Back-Roller Urban Line", sizeRaw: "OS" },
      { providerKey: "NER_27", title: "Montre GPS Garmin Instinct 3 Solar - 45 mm Noir avec Bracelet en Silicone Noir", sizeRaw: "OS" },
      { providerKey: "NER_28", title: "Barre énergétique Chimpanzee Banane/Chocolat - 55g", sizeRaw: "OS" },
      { providerKey: "NER_29", title: "Sac de Couchage Mammut Relax Down -2C", sizeRaw: "OS" },
      // New keys, not on the category blocklist. Size 16–52 must not keep them.
      { providerKey: "NER_NEW_CROWN", title: "INSIGHT Couronne 5 Points Bleu", sizeRaw: "39" },
      { providerKey: "NER_NEW_SPROCKET", title: "Pignon VAE BBB E-bike Sprocke Bleu", sizeRaw: "19" },
      { providerKey: "NER_NEW_RACK", title: "Tubus Logo Classic pannier rack", sizeRaw: "27" },
      { providerKey: "NER_NEW_DRY", title: "Lalizas Tenere dry sack 5L", sizeRaw: "32" },
      { providerKey: "NER_NEW_WASH", title: "Trousse de Toilette The North Face Base Camp S", sizeRaw: "OS" },
      { providerKey: "NER_NEW_PENCIL", title: "Vans Old Skool Youth pencil case", sizeRaw: "OS" },
      { providerKey: "NER_NEW_LENZ", title: "Lenz Contact Protection RCB 1200 Lithium Pack", sizeRaw: "42" },
      { providerKey: "NER_NEW_RING", title: "Folli follie 3R15S059Rc-52 ring", sizeRaw: "52" },
      { providerKey: "NER_NEW_BANGLE", title: "Tom hope TM0140 bracelet", sizeRaw: "OS" },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).toBe("ner_not_apparel");
    }
  });

  it("blocks new Funko, Labubu, Hot Wheels, and Spongebob toys without a key list", () => {
    delete process.env.GALAXUS_FASHION_ONLY;
    for (const input of [
      { providerKey: "STX_NEW_FUNKO", title: "Funko Pop Animation 123", brand: "Funko", suggestedRetailInclVatChf: 20 },
      { providerKey: "STX_NEW_LABUBU", title: "Labubu The Monsters Vinyl", brand: "Pop Mart", suggestedRetailInclVatChf: 40 },
      { providerKey: "STX_NEW_HW", title: "Hot Wheels Boulevard car", brand: "Hot Wheels", suggestedRetailInclVatChf: 15 },
      { providerKey: "STX_NEW_SB", title: "Youtooz Spongebob Heading Out Vinyl Figure", brand: "Youtooz", suggestedRetailInclVatChf: 30 },
      { providerKey: "WEL_NEW_SB", title: "Plushieverse: Spongebob - 3 Inch Blind Box", brand: "TeeTurtle", supplierKey: "wel", suggestedRetailInclVatChf: 12 },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).not.toBeNull();
    }
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_NEW_SB_SHOE",
        title: "Nike Dunk Low Spongebob",
        brand: "Nike",
        sizeRaw: "42",
        suggestedRetailInclVatChf: 150,
      })
    ).toBeNull();
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_BEAR_NEW",
        title: "Medicom Toy BE@RBRICK 400%",
        brand: "Bearbrick",
        suggestedRetailInclVatChf: 200,
      })
    ).toBeNull();
  });

  it("blocks category cleanup rows", () => {
    for (const providerKey of [
      "NER_0036121950047",
      "ner_0036121621008",
      "STX_000002739779",
      // 2026-11-02 off-sheet NER: bike parts, racks, dry sacks, toiletry, Lenz packs
      "NER_8717565647701",
      "NER_198266025506",
    ]) {
      expect(galaxusAssortmentBlockReason({ providerKey, title: "x" })).toBe("category_block");
    }
  });

  it("blocks sports nutrition, keeps bottles and gel-padded gear", () => {
    for (const input of [
      { providerKey: "NER_1", title: "Gel énergétique Tā Energy Pastèque salée - 40ml", brand: "Tā Energy", sizeRaw: "OS" },
      { providerKey: "NER_2", title: "Repas Lyophilisé Voyager Chili Végétalien 80g", brand: "Voyager", sizeRaw: "OS" },
      { providerKey: "NER_3", title: "Boisson Protéinée Fenioux Multi-Sports Whey+ Cookies - 750g", sizeRaw: "OS" },
      { providerKey: "NER_4", title: "Pâtes de fruits Overstims Bio Fraise - 4x25g", brand: "Overstims", sizeRaw: "OS" },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).toBe("food");
    }
    for (const input of [
      { providerKey: "NER_5", title: "Bidon Nduranz 1000 ml", brand: "Nduranz", sizeRaw: "OS" },
      { providerKey: "NER_6", title: "Selle Femme Selle Italia Diva Gel Superflow L Noir", sizeRaw: "OS" },
      { providerKey: "NER_7", title: "Chaussures Homme ASICS SONICBLAST 2 Energy Aqua", sizeRaw: "41 1/2" },
      { providerKey: "STX_8", title: "GU Wide Pants Beige", brand: "GU", sizeRaw: "M" },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).not.toBe("food");
    }
  });

  it("keeps NER English-titled apparel by clothing size", () => {
    delete process.env.GALAXUS_NER_APPAREL_ONLY;
    for (const input of [
      { providerKey: "NER_41", title: "Castelli Sorpasso RoS Bibtight", sizeRaw: "L" },
      { providerKey: "NER_42", title: "Endura Hummvee", sizeRaw: "M" },
      { providerKey: "NER_43", title: "Fox Racing Flexair Pant", sizeRaw: "32, M" },
      { providerKey: "NER_44", title: "Northwave Extreme Thermal L/S Trikot", sizeRaw: "S" },
      { providerKey: "NER_45", title: "POC VPD Air leg warmers", sizeRaw: "XL" },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).not.toBe("ner_not_apparel");
    }
    // Gear stays out even with a size letter.
    expect(
      galaxusAssortmentBlockReason({ providerKey: "NER_46", title: "Pompe à Pied Topeak Joe Blow", sizeRaw: "M" })
    ).toBe("ner_not_apparel");
  });

  it("keeps NER bags, eyewear, headwear, straps and FR shoe sizes; bike parts and helmets stay out", () => {
    delete process.env.GALAXUS_NER_APPAREL_ONLY;
    for (const input of [
      { providerKey: "NER_60", title: "The North Face Base Camp (50 l)", sizeRaw: "OS" },
      { providerKey: "NER_61", title: "Osprey 3597-Stratos backpack", sizeRaw: "OS" },
      { providerKey: "NER_62", title: "Julbo Rush polarized sunglasses", sizeRaw: "OS" },
      { providerKey: "NER_63", title: "Oakley Capacitor (Polished black, Prizm Grey)", sizeRaw: "OS" },
      { providerKey: "NER_64", title: "Patagonia Duckbill Trucker Hat - black (One size)", sizeRaw: "OS" },
      { providerKey: "NER_65", title: "Icebreaker Flexi Chute Merino neck warmer", sizeRaw: "OS" },
      { providerKey: "NER_66", title: "Suunto 22 Ath5 Silicone Strap Graphite S+M", sizeRaw: "OS" },
      { providerKey: "NER_67", title: "Altra Torin 9", sizeRaw: "38FR" },
      { providerKey: "NER_68", title: "Fox Racing W Ranger Pant", sizeRaw: "KIDXS" },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).not.toBe("ner_not_apparel");
    }
    for (const input of [
      { providerKey: "NER_70", title: "Ortlieb Taschen Back-Roller Classic (40 l, Rear rack bag)", sizeRaw: "OS" },
      { providerKey: "NER_71", title: "Garmin Edge 1040", sizeRaw: "1" },
      { providerKey: "NER_72", title: "Kask Protone Icon (59 - 62 cm)", sizeRaw: "L(59-62CM)" },
      { providerKey: "NER_73", title: "Tektro R559 - Extra Long Reach Brakes", sizeRaw: "OS" },
      { providerKey: "NER_74", title: "Pinguin Map 2023 towel", sizeRaw: "XL" },
      { providerKey: "NER_75", title: "Respro City protective mask", sizeRaw: "M" },
      { providerKey: "NER_76", title: "Coleman Cooler Box (30 l)", sizeRaw: "OS" },
      { providerKey: "NER_77", title: "MSR Hydration Reservoir (20 l)", sizeRaw: "OS" },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).toBe("ner_not_apparel");
    }
  });

  it("NER price cap uses sell price + VAT, not the 1.4 retail guess", () => {
    delete process.env.GALAXUS_MAX_RETAIL_CHF;
    // buy 250 ex VAT -> 270 incl VAT: under 300, must stay.
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "NER_50",
        title: "ASICS Gel-Quantum 360 I",
        sizeRaw: "46.5",
        purchasePriceExVatChf: 250,
      })
    ).not.toBe("price_outlier");
    // buy 290 ex VAT -> 313 incl VAT: over 300, blocked.
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "NER_51",
        title: "ASICS Gel-Quantum 360 I",
        sizeRaw: "46.5",
        purchasePriceExVatChf: 290,
      })
    ).toBe("price_outlier");
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

  it("blocks general-release shoes above 350 CHF", () => {
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_3",
        title: "Nike Dunk Low Retro White Black Panda",
        brand: "Nike",
        sizeRaw: "EU 42",
        suggestedRetailInclVatChf: 360,
      })
    ).toBe("shoe_over_cap");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_4",
        title: "Nike Air Force 1 Low '07 White",
        brand: "Nike",
        sizeRaw: "US 10.5",
        suggestedRetailInclVatChf: 355,
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

  it("keeps Nvidia GPUs / RAM; SM product-type list delists Entwicklungsboard + Kit", () => {
    for (const input of [
      { providerKey: "REI_8", title: "PNY NVIDIA RTX A2000 12GB", brand: "PNY" },
      { providerKey: "REI_9", title: "CSX DIMM DDR5-5600MHZ 8 GO CSX, CL46", brand: "CSX" },
      { providerKey: "REI_10", title: "Kingston Fury Beast 32GB DDR5 RAM", brand: "Kingston" },
      { providerKey: "REI_11", title: "CSX SODIMM CSX 2 GO DDR3-1600MHZ", brand: "CSX" },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).toBeNull();
    }
    // Excel "Entwicklungsboard + Kit" — REI path; STX often misclassifies Jetson as sneakers.
    for (const input of [
      { providerKey: "REI_12", title: "RASPBERRY PI Raspberry Pi Compute Modul 5, 2GB RAM, sans eMMC", brand: "RASPBERRY PI" },
      { providerKey: "REI_15", title: "RASPBERRY PI Netzteil USB-C 27 W für Raspberry Pi 5, weiss", brand: "RASPBERRY PI" },
    ]) {
      expect(galaxusAssortmentBlockReason(input)).toBe("product_type_block");
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
    expect(galaxusAssortmentBlockReason({ providerKey: "STX_16", title: "Ram Trucks Hot Wheels 2021", suggestedRetailInclVatChf: 20 })).toBe("non_fashion");
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
        purchasePriceExVatChf: 330,
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

  it("blocks LEGO via temp delist before price-cap checks", () => {
    delete process.env.GALAXUS_MAX_RETAIL_CHF;
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_7",
        title: "LEGO Star Wars Millennium Falcon Set 75192",
        brand: "LEGO",
        suggestedRetailInclVatChf: 1100,
      })
    ).toBe("lego");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_7b",
        title: "LEGO Star Wars Advent Calendar Set 75340",
        brand: "LEGO",
        suggestedRetailInclVatChf: 96,
      })
    ).toBe("lego");
  });

  it("blocks anything above the absolute cap even when the retail-multiple filter is off", () => {
    // Booster boxes are hobby_toy now; use a fashion SKU for the price-cap probe.
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_9",
        title: "Supreme Box Logo Hooded Sweatshirt Black",
        sizeRaw: "L",
        brand: "Supreme",
        suggestedRetailInclVatChf: 36179,
      })
    ).toBe("price_outlier");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_9b",
        title: "Supreme Box Logo Hooded Sweatshirt Black",
        sizeRaw: "L",
        brand: "Supreme",
        suggestedRetailInclVatChf: 200,
      })
    ).toBeNull();
  });

  it("blocks every supplier above 300 CHF when the cap env is unset", () => {
    delete process.env.GALAXUS_MAX_RETAIL_CHF;
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_30",
        title: "Supreme Box Logo Hooded Sweatshirt Black",
        sizeRaw: "L",
        brand: "Supreme",
        suggestedRetailInclVatChf: 301,
      })
    ).toBe("price_outlier");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_31",
        title: "Supreme Box Logo Hooded Sweatshirt Black",
        sizeRaw: "L",
        suggestedRetailInclVatChf: 300,
      })
    ).toBeNull();
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "NER_30",
        title: "Nike Dunk Low",
        brand: "Nike",
        sizeRaw: "42",
        purchasePriceExVatChf: 290,
      })
    ).toBe("price_outlier");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "NER_31",
        title: "Nike Dunk Low",
        brand: "Nike",
        sizeRaw: "42",
        purchasePriceExVatChf: 200,
      })
    ).toBeNull();
  });


  it("blocks LEGO Art / under-cap sets via temp delist (was price-cap-only after Monday rollback)", () => {
    delete process.env.GALAXUS_MAX_RETAIL_CHF;
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_5702018066386",
        title: "LEGO Art: Gustav Klimt The Kiss Set #31221",
        brand: "LEGO",
        suggestedRetailInclVatChf: 407.55,
      })
    ).toBe("lego");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_673419345705",
        title: "LEGO Winter Christmas Penguin Set 40498",
        brand: "LEGO",
        suggestedRetailInclVatChf: 92.09,
      })
    ).toBe("lego");
  });

  it("keeps REI allowlisted high-ticket sellers above the absolute cap", () => {
    delete process.env.GALAXUS_MAX_RETAIL_CHF;
    delete process.env.GALAXUS_REI_ALLOWLIST;
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "REI_0812674025278",
        gtin: "0812674025278",
        title: "NVIDIA Kit NVIDIA Jetson Orin Nano Super Dev., 67 TOPS, 8 Go DDR5",
        brand: "NVIDIA",
        purchasePriceExVatChf: 646.5,
      })
    ).toBeNull();
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "REI_9999999999999",
        title: "Random REI gadget",
        purchasePriceExVatChf: 646.5,
      })
    ).toBe("rei_not_allowlisted");
  });

  it("blocks absurd prices when the outlier filter is on", () => {
    process.env.GALAXUS_PRICE_OUTLIER_FILTER = "1";
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_9",
        title: "2019 Pokemon Sun & Moon Team Up Booster Box",
        suggestedRetailInclVatChf: 36179,
      })
    ).toBe("hobby_toy");
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "STX_10",
        title: "Hot Wheels Super Treasure Hunt 2021 Mazda",
        suggestedRetailInclVatChf: 339,
        brandRetailPrice: 2,
      })
    ).toBe("non_fashion");
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

  it("applies the absolute cap to non-StockX suppliers", () => {
    expect(
      galaxusAssortmentBlockReason({ providerKey: "HAW_2", title: "Ecksofa Leder Cognac", purchasePriceExVatChf: 6000 })
    ).toBe("price_outlier");
  });

  it("does not apply the retail-multiple filter outside StockX", () => {
    process.env.GALAXUS_PRICE_OUTLIER_FILTER = "1";
    expect(
      galaxusAssortmentBlockReason({
        providerKey: "HAW_2",
        title: "Ecksofa Leder Cognac",
        purchasePriceExVatChf: 400,
        brandRetailPrice: 10,
      })
    ).toBeNull();
  });

  it("keeps apparel under the absolute cap", () => {
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

  it("caps low-retail shoe brands at 300, others at 350", () => {
    const shoe = (brand: string, title: string, srp: number) =>
      galaxusAssortmentBlockReason({ providerKey: "STX_20", brand, title, sizeRaw: "EU 42", suggestedRetailInclVatChf: srp });
    expect(shoe("Nike", "Nike Dunk Low Panda", 340)).toBeNull();
    expect(shoe("Nike", "Nike Dunk Low Panda", 360)).toBe("shoe_over_cap");
    for (const [brand, title] of [
      ["Salomon", "Salomon XT-6 Black"],
      ["Hoka One One", "Hoka Clifton 9 Black"],
      ["On", "On Cloudmonster White"],
      ["ASICS", "ASICS Gel-Kayano 14"],
      ["Converse", "Converse Chuck 70 Hi"],
    ]) {
      expect(shoe(brand, title, 320)).toBe("shoe_over_cap");
      expect(shoe(brand, title, 290)).toBeNull();
    }
  });
});

describe("galaxusAssortmentBlockReasonForCandidate", () => {
  afterEach(() => {
    delete process.env.GALAXUS_MAX_RETAIL_CHF;
    delete process.env.GALAXUS_STX_SIZE_OUTLIER_RATIO;
  });

  it("reads variant + kickdb product fields from a feed candidate", () => {
    process.env.GALAXUS_MAX_RETAIL_CHF = "5000";
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
          suggestedRetailPriceInclVat: "399.00",
        },
        product: { name: "Nike Dunk Low Retro Grey Fog", retailPrice: 115 },
      })
    ).toBe("shoe_over_cap");
  });

  it("blocks an STX size priced far above its sibling sizes", () => {
    const size = (id: string, srp: number, stock = 1) => ({
      providerKey: `STX_${id}`,
      mapping: { supplierKey: "stx" },
      variant: {
        supplierVariantId: `stx_${id}`,
        supplierSku: "L47452800",
        supplierProductName: "Salomon XT-6 Black",
        supplierBrand: "Salomon",
        sizeRaw: "EU 42",
        suggestedRetailPriceInclVat: srp,
        stock,
      },
    });
    const sizes = [size("a", 150), size("b", 155), size("c", 160), size("d", 290)];
    const index = buildStxSizePriceMedianIndex(sizes);
    expect(galaxusAssortmentBlockReasonForCandidate(sizes[3], index)).toBe("size_price_outlier");
    expect(galaxusAssortmentBlockReasonForCandidate(sizes[0], index)).toBeNull();
    expect(galaxusAssortmentBlockReasonForCandidate(sizes[3])).toBeNull();

    const twoSizes = [size("a", 150), size("d", 290)];
    expect(galaxusAssortmentBlockReasonForCandidate(twoSizes[1], buildStxSizePriceMedianIndex(twoSizes))).toBeNull();

    process.env.GALAXUS_STX_SIZE_OUTLIER_RATIO = "0";
    expect(galaxusAssortmentBlockReasonForCandidate(sizes[3], index)).toBeNull();
    delete process.env.GALAXUS_STX_SIZE_OUTLIER_RATIO;
  });
});
