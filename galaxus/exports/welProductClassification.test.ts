import { describe, expect, it } from "vitest";
import { classifyGalaxusProductKind, requiresGalaxusSizeSpec, resolveGalaxusProductCategoryPath } from "@/galaxus/exports/productClassification";
import { buildGalaxusSizeSpecRow } from "@/galaxus/exports/sizeSpecifications";
import { classifyWelProductKind } from "@/galaxus/exports/welProductClassification";

describe("WEL classification", () => {
  it("defaults Everdell to boardgame not sneakers", () => {
    expect(
      classifyGalaxusProductKind({
        supplierKey: "wel",
        title: "Everdell: Silverfrost - Collectors Edition (EN)",
        brand: "Starling Games",
      })
    ).toBe("boardgame");
    expect(
      resolveGalaxusProductCategoryPath({
        supplierKey: "wel",
        title: "Everdell: Silverfrost - Collectors Edition (EN)",
      })
    ).toBe("Sport + Toys > Brettspiele");
  });

  it("maps WellPlayed Shopify product_type Board Games", () => {
    expect(
      classifyWelProductKind({
        supplierProductType: "Board Games",
        title: "Catan",
        brand: "Kosmos",
      })
    ).toBe("boardgame");
  });

  it("maps TCG via product_type Card Games", () => {
    expect(
      classifyGalaxusProductKind({
        supplierKey: "wel",
        supplierProductType: "Card Games",
        title: "Pokémon TCG Booster",
        brand: "The Pokémon Company International",
      })
    ).toBe("cardgame");
  });

  it("maps Gamegenic sleeve accessory", () => {
    expect(
      classifyGalaxusProductKind({
        supplierKey: "wel",
        supplierProductType: "Sleeve",
        title: "Prime Sleeves White",
        brand: "Gamegenic",
      })
    ).toBe("game_accessory");
  });
});

describe("trousers / sweatpants size spec", () => {
  it("KickDB sweatpants breadcrumb sends Clothing size", () => {
    const row = buildGalaxusSizeSpecRow({
      providerKey: "STX_TEST",
      sizeRaw: "M",
      supplierTitle: "Sp5der VVS Sweatpant Pink",
      brand: "Sp5der",
      breadcrumbAliases: ["apparel", "bottoms", "sweatpants"],
      supplierKey: "stx",
    });
    expect(row?.SpecificationKey).toBe("Clothing size");
    expect(row?.SpecificationValue).toBe("M");
  });

  it("KickDB pants breadcrumb sends Clothing size", () => {
    expect(requiresGalaxusSizeSpec("trousers")).toBe(true);
    const row = buildGalaxusSizeSpecRow({
      providerKey: "STX_TEST",
      sizeRaw: "M",
      supplierTitle: "Nike x BODE Scrimmage Pant Blue/Cream",
      breadcrumbAliases: ["apparel", "bottoms", "pants"],
      supplierKey: "stx",
    });
    expect(row?.SpecificationKey).toBe("Clothing size");
  });
});

describe("UGG footwear", () => {
  it("UGG Tasman → Hausschuhe not Sneakers", () => {
    expect(
      classifyGalaxusProductKind({
        supplierKey: "stx",
        brand: "UGG",
        title: "UGG Tasman Slipper Chestnut",
        sizeRaw: "EU 43",
      })
    ).toBe("slippers");
    expect(
      resolveGalaxusProductCategoryPath({
        supplierKey: "stx",
        brand: "UGG",
        title: "UGG Tasman Slipper Chestnut",
      })
    ).toContain("Hausschuhe");
  });

  it("UGG Neumel Boot → Stiefel with shoe size", () => {
    const row = buildGalaxusSizeSpecRow({
      providerKey: "STX_UGG",
      sizeRaw: "EU 43",
      supplierTitle: "UGG Neumel Distressed Boot Burnt Cedar",
      brand: "UGG",
      supplierKey: "stx",
    });
    expect(row?.SpecificationKey).toBe("Shoe size (EU)");
    expect(row?.SpecificationValue).toBe("43");
  });
});
