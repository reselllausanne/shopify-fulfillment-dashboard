import { describe, expect, it } from "vitest";
import { buildShopifyListing, dedupeColor } from "./buildShopifyListing";
import type { ProductFromData } from "./createProductFromData";

const data: ProductFromData = {
  brand: "Nike",
  name: "Nike Court Borough Low 2",
  subtitle: "Schuh für Babys und Kleinkinder",
  genders: ["GIRLS", "BOYS"],
  sku: "BQ5453-001",
  color: "Schwarz/Schwarz/Schwarz",
  images: ["https://x/a.png"],
  sellPrice: 21,
  sizes: [{ size: "17", gtin: "00193145977099", stock: 1 }],
};

describe("buildShopifyListing", () => {
  const l = buildShopifyListing(data);
  it("matches normal STX product shape", () => {
    expect(l.tags).toEqual(["New"]);
    expect(l.productType).toBe("Sneakers");
    expect(l.option).toBe("Taille");
    expect(l.category).toBe("gid://shopify/TaxonomyCategory/aa-8-11-5");
    expect(l.variantSku("17")).toBe("BQ5453-001-17");
    expect(l.descriptionHtml).toContain("Code style :</strong> BQ5453-001");
  });
  it("no duplicated brand or color", () => {
    expect(l.title).toBe("Nike Court Borough Low 2 Schwarz");
    expect(dedupeColor("A/A/B")).toBe("A/B");
    expect(l.handle).toBe("nike-court-borough-low-2-schwarz");
  });
});
