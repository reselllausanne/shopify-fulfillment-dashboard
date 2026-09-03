import { describe, expect, it } from "vitest";
import {
  buildGalaxusSizeSpecRow,
  formatGalaxusSizeSpecValue,
  GALAXUS_CLOTHING_SIZE_KEY,
  resolveGalaxusExportClassification,
} from "@/galaxus/exports/sizeSpecifications";
import { classifyGalaxusProductKind, resolveGalaxusProductCategoryPath } from "@/galaxus/exports/productClassification";
import { classifySnowleaderCategoryLabel } from "@/app/lib/snowleaderGalaxusCategories";
import { GALAXUS_LENGTH_CM_KEY, GALAXUS_SHOE_SIZE_KEY } from "@/galaxus/exports/sizeSpecifications";

describe("productClassification", () => {
  it("classifies The Brick phone lock from supplier title", () => {
    expect(classifyGalaxusProductKind({ title: "The Brick - Gray" })).toBe("phone");
  });
});

describe("resolveGalaxusExportClassification", () => {
  it("classifies Essentials tee as apparel clothing size", () => {
    const result = resolveGalaxusExportClassification({
      supplierTitle: "Essentials Tee Light Oatmeal (SS22)",
    });
    expect(result.isFootwear).toBe(false);
    expect(result.requiresSizeSpec).toBe(true);
    expect(result.categoryPath).toContain("Bekleidung");
  });

  it("classifies The Brick as phone accessory without size spec", () => {
    const result = resolveGalaxusExportClassification({
      supplierTitle: "The Brick - Gray",
      supplierSku: "grey-brick-1.0",
      kickdbTitle: "The Brick",
      kickdbDescription: "Access the subscription-free Brick app on App Store or Google Play Store",
    });
    expect(result.kind).toBe("phone");
    expect(result.isFootwear).toBe(false);
    expect(result.requiresSizeSpec).toBe(false);
    expect(result.categoryPath).toContain("Smartphone Zubehör");
  });

  it("classifies phone products before footwear keywords in descriptions", () => {
    expect(
      classifyGalaxusProductKind({
        title: "Mystery Gadget",
        description: "Control your phone and block distractions with this magnet mount",
      })
    ).toBe("phone");
  });

  it("classifies sneaker fridge magnets as home accessory, not phone", () => {
    expect(
      classifyGalaxusProductKind({
        title: "204L Sneakers Magnet",
        brand: "New Balance",
        supplierKey: "ner",
      })
    ).toBe("home_accessory");
    expect(
      resolveGalaxusProductCategoryPath({
        title: "204L Sneakers Magnet",
        brand: "New Balance",
        supplierKey: "ner",
      })
    ).toContain("Dekorationartikel");
  });

  it("keeps New Balance Magnet colorway as sneakers, not phone", () => {
    expect(
      classifyGalaxusProductKind({
        title: "New Balance 327 Grey Matter Magnet",
        brand: "New Balance",
        supplierKey: "stx",
      })
    ).toBe("sneakers");
  });
});

describe("buildGalaxusSizeSpecRow", () => {
  it("exports Clothing size for Essentials tee", () => {
    expect(
      buildGalaxusSizeSpecRow({
        providerKey: "THE_198437210397",
        sizeRaw: "XS",
        supplierTitle: "Essentials Tee Light Oatmeal (SS22)",
      })
    ).toEqual({
      ProviderKey: "THE_198437210397",
      SpecificationKey: GALAXUS_CLOTHING_SIZE_KEY,
      SpecificationValue: "XS",
    });
  });

  it("skips size spec for phone lock accessories", () => {
    expect(
      buildGalaxusSizeSpecRow({
        providerKey: "THE_198715528718",
        sizeRaw: "OS",
        supplierTitle: "The Brick - Gray",
        supplierSku: "grey-brick-1.0",
        kickdbTitle: "The Brick",
        kickdbDescription: "Access the subscription-free Brick app",
      })
    ).toBeNull();
  });

  it("strips EU prefix and converts adidas fractional footwear sizes", () => {
    expect(formatGalaxusSizeSpecValue("EU 43 1/3", "sneakers")).toBe("43");
    expect(formatGalaxusSizeSpecValue("EU 38 2/3", "sneakers")).toBe("38.5");
  });

  it("leaves decimal and whole footwear sizes unchanged", () => {
    expect(formatGalaxusSizeSpecValue("EU 42.5", "sneakers")).toBe("42.5");
    expect(formatGalaxusSizeSpecValue("EU 42", "sneakers")).toBe("42");
  });

  it("exports ski length in cm", () => {
    expect(formatGalaxusSizeSpecValue("173 cm", "ski")).toBe("173");
    expect(formatGalaxusSizeSpecValue("183.4", "langlauf_ski")).toBe("183.4");
  });
});

describe("productClassification extended kinds", () => {
  it("classifies Stanley tumbler out of shoes", () => {
    expect(classifyGalaxusProductKind({ title: "Stanley Flowstate Quencher 40oz Tumbler Arctic Twist", brand: "Stanley" })).toBe("tumbler");
    const path = resolveGalaxusProductCategoryPath({ title: "Stanley Flowstate Quencher 40oz Tumbler", brand: "Stanley" });
    expect(path).not.toContain("Schuhe");
    expect(path).toContain("Thermosflaschen");
  });

  it("classifies Canon camera out of shoes", () => {
    expect(classifyGalaxusProductKind({ title: "Canon PowerShot SX740 HS Digital Camera 2955C001 Black", brand: "Canon" })).toBe("camera");
    const path = resolveGalaxusProductCategoryPath({ title: "Canon PowerShot SX740 HS Digital Camera", brand: "Canon" });
    expect(path).not.toContain("Schuhe");
    expect(path).toContain("Kameras");
  });

  it("classifies Swatch watch out of shoes", () => {
    expect(classifyGalaxusProductKind({ title: "Swatch x Omega Bioceramic Moonswatch SO33N702L", brand: "Swatch" })).toBe("watch");
    expect(resolveGalaxusProductCategoryPath({ title: "Swatch Moonswatch", brand: "Swatch" })).toContain("Uhren");
  });

  it("classifies LEGO sets as lego, not shoes", () => {
    expect(classifyGalaxusProductKind({ title: "LEGO Star Wars Yavin 4 Rebel Base Set 75365", brand: "LEGO" })).toBe("lego");
    expect(resolveGalaxusProductCategoryPath({ title: "LEGO Star Wars Set", brand: "LEGO" })).not.toContain("Schuhe");
  });

  it("classifies Sprayground backpacks", () => {
    expect(classifyGalaxusProductKind({ title: "Sprayground Drip Check Shark Backpack", brand: "Sprayground" })).toBe("backpack");
  });

  it("classifies Apple Airpods as headphones, not shoes", () => {
    expect(classifyGalaxusProductKind({ title: "Apple Airpods 4 MXP63LL/A", brand: "Apple" })).toBe("headphone");
  });

  it("classifies adidas sweatpants as trousers, not sneakers", () => {
    expect(classifyGalaxusProductKind({ title: "adidas x Thug Club Teamgeist Sweatpants Black", brand: "Adidas" })).toBe("trousers");
  });

  it("does not misclassify adidas Ultra Boost LEGO as a LEGO set (collab name, stays in shoes fallback)", () => {
    expect(classifyGalaxusProductKind({ title: "adidas Ultra Boost LEGO Color Pack Blue", brand: "Adidas" })).not.toBe("lego");
  });

  it("keeps The Brick as phone (regression)", () => {
    expect(classifyGalaxusProductKind({ title: "The Brick - Gray" })).toBe("phone");
  });
});

describe("KickDB breadcrumb-driven classification (resilient)", () => {
  it("adidas Ultra Boost (not in FOOTWEAR_RE) is sneakers via KickDB breadcrumbs", () => {
    // Free-text regex misses "Ultra Boost". KickDB breadcrumbs must save it.
    expect(
      classifyGalaxusProductKind({
        title: "adidas Ultra Boost 5.0 DNA White",
        brand: "Adidas",
        breadcrumbAliases: ["sneakers", "lifestyle"],
      })
    ).toBe("sneakers");
    expect(
      resolveGalaxusProductCategoryPath({
        title: "adidas Ultra Boost 5.0 DNA White",
        brand: "Adidas",
        breadcrumbAliases: ["sneakers", "lifestyle"],
      })
    ).toContain("Sneakers");
  });

  it("KickDB product_type=sneakers overrides missing free-text signals", () => {
    expect(
      classifyGalaxusProductKind({
        title: "Some Obscure Model Name",
        productType: "sneakers",
      })
    ).toBe("sneakers");
  });

  it("KickDB apparel breadcrumb maps to Bekleidung path", () => {
    const path = resolveGalaxusProductCategoryPath({
      title: "Some Tee",
      breadcrumbAliases: ["apparel", "tops", "t-shirts"],
    });
    expect(path).toContain("Bekleidung");
    expect(path).not.toContain("Schuhe");
  });

  it("numeric EU sizeRaw hints footwear when no other signal", () => {
    expect(
      classifyGalaxusProductKind({
        title: "",
        sizeRaw: "42",
      })
    ).toBe("sneakers");
  });

  it("Ultra Boost gets Shoe size spec via KickDB breadcrumbs (regression for regex miss)", () => {
    const row = buildGalaxusSizeSpecRow({
      providerKey: "STX_TEST",
      sizeRaw: "EU 42.5",
      supplierTitle: "adidas Ultra Boost 5.0 DNA White",
      brand: "Adidas",
      breadcrumbAliases: ["sneakers", "lifestyle"],
    });
    expect(row?.SpecificationKey).toBe("Shoe size (EU)");
    expect(row?.SpecificationValue).toBe("42.5");
  });
});

describe("Snowleader category classification", () => {
  it("maps Skijacken to ski_jacket not generic apparel", () => {
    expect(classifySnowleaderCategoryLabel("Skijacken")).toBe("ski_jacket");
    expect(
      resolveGalaxusProductCategoryPath({
        supplierKey: "snl",
        supplierProductType: "Skijacken",
      })
    ).toBe("Sport > Wintersport > Wintersportbekleidung > Skijacke");
  });

  it("maps Wanderschuhe to Sport > Outdoor path not Mode Stiefel", () => {
    expect(classifySnowleaderCategoryLabel("Wanderschuhe Herren")).toBe("hiking_boots");
    expect(
      resolveGalaxusProductCategoryPath({
        supplierKey: "snl",
        supplierProductType: "Wanderschuhe Herren",
      })
    ).toBe("Sport > Outdoor > Wandern > Wanderschuhe");
  });

  it("maps Fleecejacken to outdoor jacket path", () => {
    expect(classifySnowleaderCategoryLabel("Fleecejacken")).toBe("outdoor_jacket");
    expect(
      resolveGalaxusProductCategoryPath({
        supplierKey: "snl",
        supplierProductType: "Fleecejacken",
      })
    ).toBe("Sport > Outdoor > Outdoorbekleidung > Outdoorjacken");
  });

  it("maps Rucksäcke to Sport > Taschen + Gepäck path", () => {
    expect(classifySnowleaderCategoryLabel("Wanderrucksäcke")).toBe("backpack");
    expect(
      resolveGalaxusProductCategoryPath({
        supplierKey: "snl",
        supplierProductType: "Wanderrucksäcke",
      })
    ).toBe("Sport > Taschen + Gepäck > Rucksack");
  });

  it("maps Mützen to beanie leaf path not generic Accessoires", () => {
    expect(classifySnowleaderCategoryLabel("Mützen")).toBe("beanie");
    expect(
      resolveGalaxusProductCategoryPath({
        supplierKey: "snl",
        supplierProductType: "Mützen",
      })
    ).toBe("Mode > Alles in Mode > Accessoires > Hüte + Caps > Mütze");
  });

  it("maps Skis to alpine ski with length spec", () => {
    expect(classifySnowleaderCategoryLabel("Skis")).toBe("ski");
    const row = buildGalaxusSizeSpecRow({
      providerKey: "SNL_TEST",
      sizeRaw: "173 cm",
      supplierKey: "snl",
      supplierProductType: "Skis",
    });
    expect(row?.SpecificationKey).toBe(GALAXUS_LENGTH_CM_KEY);
    expect(row?.SpecificationValue).toBe("173");
  });

  it("maps Skischuhe to ski_boots with shoe size", () => {
    expect(classifySnowleaderCategoryLabel("Skischuhe")).toBe("ski_boots");
    const row = buildGalaxusSizeSpecRow({
      providerKey: "SNL_TEST",
      sizeRaw: "EU 27.5",
      supplierKey: "snl",
      supplierProductType: "Skischuhe",
    });
    expect(row?.SpecificationKey).toBe(GALAXUS_SHOE_SIZE_KEY);
    expect(row?.SpecificationValue).toBe("27.5");
  });
});
