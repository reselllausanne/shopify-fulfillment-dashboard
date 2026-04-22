import { describe, expect, it } from "vitest";
import { createDecathlonExclusionSummary } from "../mapping";
import { buildProductRow } from "../productCsv";

describe("decathlon product CSV", () => {
  it("builds a product row with identifier and EAN", () => {
    const summary = createDecathlonExclusionSummary();
    const candidate: any = {
      providerKey: "STX_1234567890123",
      gtin: "1234567890123",
      mapping: {},
      kickdbVariant: { sizeEu: "42" },
      product: {
        name: "Test Shoe",
        description: "Sample description",
        brand: "SampleBrand",
        gender: "Men",
        colorway: "Black",
      },
      variant: {
        supplierProductName: "Test Shoe",
        supplierBrand: "SampleBrand",
        supplierVariantId: "stx_1",
        hostedImageUrl: "https://example.com/image.jpg",
        sizeRaw: "42",
        manualLock: true,
        manualStock: 2,
        manualPrice: "99",
      },
    };

    const row = buildProductRow(candidate, summary);
    expect(row).not.toBeNull();
    expect(row?.["Product Identifier"]).toBe("STX_1234567890123");
    expect(row?.["codes EAN"]).toBe("1234567890123");
    expect(row?.["Catégorie"]).toBeTruthy();
  });

  it("rewrites StockX-style WebP query param to jpg for Main Image", () => {
    const summary = createDecathlonExclusionSummary();
    const url =
      "https://images.stockx.com/images/Air-Jordan-6.jpg?fit=fill&bg=FFFFFF&w=700&h=500&fm=webp&auto=compress&q=90";
    const candidate: any = {
      providerKey: "STX_1234567890123",
      gtin: "1234567890123",
      mapping: {},
      kickdbVariant: { sizeEu: "42" },
      product: {
        name: "Test Shoe",
        brand: "Jordan",
        gender: "Men",
        colorway: "Khaki",
      },
      variant: {
        supplierProductName: "Test Shoe",
        supplierBrand: "Jordan",
        supplierVariantId: "stx_1",
        images: [url],
        sizeRaw: "42",
        weightGrams: 1000,
      },
    };
    const row = buildProductRow(candidate, summary);
    expect(row?.["Main Image"]).toContain("fm=jpg");
    expect(row?.["Main Image"]).not.toMatch(/fm=webp/i);
  });
});
