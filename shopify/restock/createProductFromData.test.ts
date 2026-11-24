import { describe, expect, it } from "vitest";
import { buildNerRows, validateProductFromData, type ProductFromData } from "./createProductFromData";

const base: ProductFromData = {
  brand: "Nike",
  name: "Court Borough Low 2",
  sku: "BQ5453-001",
  color: "Black",
  images: ["https://static.nike.com/a.png"],
  sellPrice: 54.9,
  sizes: [
    { size: "2C", gtin: "0196153270001", stock: 1 },
    { size: "3C", gtin: "0196153270018", stock: 2 },
  ],
};

describe("createProductFromData", () => {
  it("valid data has no missing field", () => {
    expect(validateProductFromData(base)).toEqual([]);
  });
  it("flags missing brand, image, bad gtin", () => {
    const m = validateProductFromData({
      ...base,
      brand: "",
      images: [],
      sizes: [
        { size: "2C", gtin: "123", stock: 1 },
        { size: "3C", gtin: "123", stock: 1 },
      ],
    });
    expect(m).toEqual(expect.arrayContaining(["brand", "images", "gtin:2C"]));
  });
  it("builds ner rows with ex-VAT price and catalog identity", () => {
    const rows = buildNerRows(base);
    expect(rows).toHaveLength(2);
    expect(rows[0].kickdbVariantId).toBe("nike-BQ5453-001-2C");
    expect(rows[0].providerKey).toBe("STX_0196153270001");
    expect(rows[0].brand).toBe("Nike");
    expect(rows[0].priceExVat).toBeCloseTo(50.79, 2);
    expect(rows[0].images[0]).toMatch(/^https/);
    expect(rows[0].providerKey).toBeTruthy();
  });
});
