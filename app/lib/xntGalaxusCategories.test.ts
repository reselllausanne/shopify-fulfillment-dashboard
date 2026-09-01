import { describe, expect, it } from "vitest";
import { classifyXntGalaxusKind } from "@/app/lib/xntGalaxusCategories";
import {
  classifyGalaxusProductKind,
  resolveGalaxusProductCategoryPath,
} from "@/galaxus/exports/productClassification";
import { GALAXUS_CATEGORY_PATHS } from "@/galaxus/exports/galaxusCategoryPaths";

describe("classifyXntGalaxusKind", () => {
  it.each([
    ["Verre de bistrot français Amber, 250 ml", "Duralex", "drinking_glass"],
    ["Tasse en porcelaine, Blanc", "Kahla", "mug"],
    ["Assiette plate, Blanc", "Seltmann Weiden", "plate"],
    ["Couteau de cuisine, Acier", "Victorinox", "cutlery"],
    ["Casserole en fonte, Rouge", "Le Creuset", "cookware"],
    ["Ausstechform Stern", "Städter", "kitchen_tool"],
    ["Partyrezepte von A-Z", "Dr. Oetker Verlag", "book"],
    ["Housse de couette réversible en demi-lin, Vert grisâtre-blanc, 155 × 220 cm", "elegante", "bedding"],
    ["Serviette de bain, Blanc", "Manufactum", "towel"],
    ["Ceinture cousue main, Marron foncé", "Ludwig Schröder", "belt"],
    ["Gant tricoté pour homme, Anthracite", "Pure Pure", "gloves"],
    ["Écharpe en laine, Gris", "Lanius", "scarf"],
    ["Bonnet tricoté unisexe à côtes, Anthracite", "Rauma Ullvarefabrikk", "beanie"],
    ["Chaussettes côtelées pour femmes, Noir", "Lanius", "socks"],
    ["Pantalons pour femmes, Bleu foncé", "Christiane Strobel", "trousers"],
    ["jeans pour femmes à ourlet retroussé »., Bleu clair", "Lanius", "trousers"],
    ["T-shirt enfant, Rose", "Pure Pure", "tshirt"],
    ["Pull à col roulé uni pour femme, Vert foncé", "Lanius", "pullover"],
    ["Chemise-soutien-gorge pour femme avec dentelle, Noir", "Comazo", "underwear"],
    ["Robe chemisier femme boutonnée, Anthracite", "Oska", "dress"],
    ["Veste en cuir de cheval Pull-up pour homme, Marron noir", "Hack Lederware", "light_jacket"],
    ["Chaussons en feutre, Bleu", "Haflinger", "slippers"],
    ["Bottes en cuir pour femmes, Noir", "Werner Schuhe", "boots"],
    ["Baskets G-Machu, Vert et beige", "Genesis Footwear", "sneakers"],
    ["Moc Boot pour homme en daim, Olive", "Red Wing Shoe Company", "boots"],
    ["USB 3.0 SuperSpeed Kabel A Stecker > Micro B Stecker", "goobay", "usb_cable"],
    ["Makeblock Flammensensor V1", "Makeblock", "dev_board"],
    ["Crochet de vestiaire en aluminium, Noir", "Essem Design", "home_accessory"],
    ["Liiton Whiskyglas-Untersetzer, 4er-Set", "Liiton", "drinking_glass"],
    ["Culotte pour femme, Noir", "Manufactum", "underwear"],
    ["Leggings en jersey pour femme, Noir", "Armedangels", "trousers"],
  ] as const)("%s (%s) → %s", (title, brand, expected) => {
    expect(classifyXntGalaxusKind({ title, brand })).toBe(expected);
  });

  it("brand hint when title has no keyword", () => {
    expect(classifyXntGalaxusKind({ title: "Model 12", brand: "Le Creuset" })).toBe("kitchen_tool");
    expect(classifyXntGalaxusKind({ title: "Adapter Set", brand: "goobay" })).toBe("usb_cable");
    expect(classifyXntGalaxusKind({ title: "Style 01", brand: "Armedangels" })).toBe("apparel");
  });

  it("defaults to home_accessory", () => {
    expect(classifyXntGalaxusKind({ title: "Objet divers", brand: "Unknown Co" })).toBe(
      "home_accessory"
    );
  });
});

describe("XNT via classifyGalaxusProductKind", () => {
  it("routes supplierKey=xnt through XNT classifier", () => {
    expect(
      classifyGalaxusProductKind({
        title: "Verre de bistrot français Amber, 250 ml",
        brand: "Duralex",
        supplierKey: "xnt",
      })
    ).toBe("drinking_glass");
  });

  it("does not dump unmatched XNT into sneakers", () => {
    const kind = classifyGalaxusProductKind({
      title: "Objet décoratif",
      brand: "Essem Design",
      supplierKey: "xnt",
      sizeRaw: "ONE",
    });
    expect(kind).toBe("home_accessory");
    expect(kind).not.toBe("sneakers");
  });

  it("resolves leaf paths for kitchen + fashion", () => {
    const glass = resolveGalaxusProductCategoryPath({
      title: "Verre de bistrot français Amber, 250 ml",
      brand: "Duralex",
      supplierKey: "xnt",
    });
    expect(glass).toBe(GALAXUS_CATEGORY_PATHS.drinking_glass);
    expect(glass.split(" > ").length).toBeGreaterThanOrEqual(3);

    const pants = resolveGalaxusProductCategoryPath({
      title: "Pantalons pour femmes, Bleu foncé",
      brand: "Christiane Strobel",
      supplierKey: "xnt",
    });
    expect(pants).toContain("Hosen");
  });
});
