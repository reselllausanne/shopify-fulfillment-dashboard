import { describe, expect, it } from "vitest";
import {
  buildGalaxusSizeSpecRow,
  formatGalaxusSizeSpecValue,
  GALAXUS_CLOTHING_SIZE_KEY,
  resolveGalaxusExportClassification,
} from "@/galaxus/exports/sizeSpecifications";
import { classifyGalaxusProductKind } from "@/galaxus/exports/productClassification";

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
