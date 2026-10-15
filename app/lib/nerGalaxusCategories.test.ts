import { describe, expect, it } from "vitest";
import { classifyNerGalaxusKind } from "@/app/lib/nerGalaxusCategories";
import { classifyGalaxusProductKind, resolveGalaxusProductCategoryPath } from "@/galaxus/exports/productClassification";
import { buildGalaxusSizeSpecRow } from "@/galaxus/exports/sizeSpecifications";

describe("classifyNerGalaxusKind", () => {
  it.each([
    ["Maillot Manches Courtes Le Col Pro Noir Homme", "bike_jersey"],
    ["Maillot de bain Z3rod Une Pièce Vortex Nebula Femme", "swimsuit"],
    ["Jammer Nike Swim Hydrastrong Graphic Noir Homme", "swim_trunks"],
    ["Maillot de Compression Under Armour Heatgear Armour Blanc Homme", "base_layer_top"],
    ["Sous-Maillot Sans Manches Unisexe LeBram Training Blanc", "base_layer_top"],
    ["Combinaison Trifonction Orca Athlex Race Blanc/Noir Femme", "bike_jersey"],
    ["Cuissard Court Castelli Escape Noir Homme", "bike_pants"],
    ["Veste Coupe-Vent Spiuk Profit Ultralight Noir", "light_jacket"],
    ["Veste Sans Manches LeBram Training Vert Kaki", "vest"],
    ["Veste Sofstshell Millet K Absosulte Shield Vert", "outdoor_jacket"],
    ["Doudoune RAB Microlight Noir Femme", "winter_jacket"],
    ["Doudoune Sans Manches AYAQ Forno Blue Slate", "vest"],
    ["Sweat à Capuche Chrome Merino Cobra 3.0 Marron", "pullover"],
    ["Débardeurs TYR SOL MEN S AIRTEC TNK", "tshirt"],
    ["Tee-shirt ASICS Fujitrail Elite", "tshirt"],
    ["Pantalon VTT Patagonia Dirt Craft Noir", "bike_pants"],
    ["Pantalon Millet All Outdoor Xcs 200 Bleu Femme", "outdoor_pants"],
    ["Leggings INOV-8 ACTIVE 3/4 TIGHTS W", "trousers"],
    ["Paire de Chaussettes LeBram Training Bleu Marine", "sport_socks"],
    ["Paire de Gants Longs LeBram Off-Road Noir", "gloves"],
    ["Brassière Under Armour Infinity 2.0 medium support", "sport_bra"],
    ["Boxers Saxx Multi-Sport Mesh Noir Homme (Lot de 2)", "underwear"],
    ["Casquette The North Face 66 Flashdry Vert", "cap"],
    ["Bonnet Millet Chamonix Relief Vert", "beanie"],
    ["Tour de cou Wilma Mona Bleu Femme", "ski_mask"],
    ["Chaussures de Randonnée Salomon X Ultra 360 Gore-Tex", "hiking_boots"],
    ["Chaussures Trail Salomon Speedcross 6 GTX Kaki/Rose Femme", "trail_shoes"],
    ["Chaussures Running Asics GT-2000 15 Orange/Blanc Homme", "running_shoes"],
    ["Sac à dos Mako French Touch Noir", "backpack"],
    ["Lunettes Rapha Reis Noir", "sunglasses"],
    ["Paire de Couvre-Chaussures LeBram Race Blanc", "gaiters"],
  ])("%s → %s", (title, kind) => {
    expect(classifyNerGalaxusKind({ title })).toBe(kind);
  });

  it("returns null for brand/model-only shoe titles (falls back to generic rules)", () => {
    expect(classifyNerGalaxusKind({ title: "adidas Gazelle Indoor - Trace Brown" })).toBeNull();
    expect(classifyGalaxusProductKind({ title: "adidas Gazelle Indoor - Trace Brown", supplierKey: "ner", sizeRaw: "46" })).toBe(
      "sneakers"
    );
  });

  it("does not hijack other suppliers", () => {
    expect(classifyGalaxusProductKind({ title: "Maillot Manches Courtes", supplierKey: "stx" })).not.toBe("bike_jersey");
  });

  it("routes jerseys to Velotrikot, not Sneakers", () => {
    expect(
      resolveGalaxusProductCategoryPath({ title: "Maillot Manches Courtes Le Col Pro Noir Homme", supplierKey: "ner", sizeRaw: "XL" })
    ).toBe("Sport > Bike > Velobekleidung > Velotrikot");
  });
});

describe("NER size spec rows", () => {
  const row = (title: string, sizeRaw: string) =>
    buildGalaxusSizeSpecRow({ providerKey: "NER_1", sizeRaw, supplierTitle: title, supplierKey: "ner" });

  it("sends Clothing size for an alpha-sized jersey (was Shoe size (EU)=XL)", () => {
    expect(row("Maillot Manches Courtes Le Col Pro Noir Homme", "XL")).toMatchObject({
      SpecificationKey: "Clothing size",
      SpecificationValue: "XL",
    });
  });

  it("sends Trouser size and strips the FR suffix", () => {
    expect(row("Pantalon The North Face Summit Off Width Noir Femme", "34FR")).toMatchObject({
      SpecificationKey: "Trouser size",
      SpecificationValue: "34",
    });
  });

  it("sends Swimming trunks size for jammers", () => {
    expect(row("Jammer Nike Swim HydraStrong Sprayfetti Noir Homme", "34FR")).toMatchObject({
      SpecificationKey: "Swimming trunks size",
    });
  });

  it("sends Shoe size for socks, Bra size for sports bras", () => {
    expect(row("Paire de Chaussettes Aéro LeBram Race Noir", "43-47")?.SpecificationKey).toBe("Shoe size");
    expect(row("Brassière Under Armour Infinity 2.0", "M")?.SpecificationKey).toBe("Bra size");
  });

  it("keeps Shoe size (EU) for real shoes", () => {
    expect(row("Chaussures Running Asics GT-2000 15 Orange/Blanc Homme", "45")).toMatchObject({
      SpecificationKey: "Shoe size (EU)",
      SpecificationValue: "45",
    });
  });
});

describe("size spec kind follows sizeRaw when the title has no signal", () => {
  it("STX alpha-sized item without apparel words → Clothing size, not Shoe size (EU)", () => {
    expect(
      buildGalaxusSizeSpecRow({ providerKey: "STX_1", sizeRaw: "S", supplierTitle: "Palace Ferg Sky Blue", supplierKey: "stx" })
        ?.SpecificationKey
    ).toBe("Clothing size");
  });
});
