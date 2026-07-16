import { describe, expect, it } from "vitest";
import {
  buildGalaxusSizeSpecRow,
  formatGalaxusSizeSpecValue,
  GALAXUS_CLOTHING_SIZE_KEY,
  resolveGalaxusExportClassification,
} from "@/galaxus/exports/sizeSpecifications";
import { classifyGalaxusProductKind, resolveGalaxusProductCategoryPath } from "@/galaxus/exports/productClassification";

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
    expect(formatGalaxusSizeSpecValue("EU 43 1/3", true)).toBe("43");
    expect(formatGalaxusSizeSpecValue("EU 38 2/3", true)).toBe("38.5");
  });

  it("leaves decimal and whole footwear sizes unchanged", () => {
    expect(formatGalaxusSizeSpecValue("EU 42.5", true)).toBe("42.5");
    expect(formatGalaxusSizeSpecValue("EU 42", true)).toBe("42");
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
