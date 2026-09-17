import { describe, expect, it } from "vitest";
import {
  chooseBldIndexCandidates,
  extractBldAlgoliaConfig,
  mapBldHitToProduct,
} from "@/app/lib/beleuchtungdirektClient";

describe("extractBldAlgoliaConfig", () => {
  it("parses app id, key and index from storefront script", () => {
    const html = `
      <script>
        window.algoliaConfig = {"applicationId":"SCY8N8WJQQ","apiKey":"abc123","indexName":"m2_prod_foo","sortingIndices":[{"name":"m2_prod_foo_products_price_default_asc"}]};
      </script>
    `;
    const cfg = extractBldAlgoliaConfig(html);
    expect(cfg.applicationId).toBe("SCY8N8WJQQ");
    expect(cfg.apiKey).toBe("abc123");
    expect(cfg.indexName).toBe("m2_prod_foo");
  });
});

describe("chooseBldIndexCandidates", () => {
  it("includes base, products and sorting indices", () => {
    const names = chooseBldIndexCandidates({
      applicationId: "A",
      apiKey: "K",
      indexName: "m2_prod_foo",
      sortingIndices: [{ name: "m2_prod_foo_products_price_default_asc" }],
    });
    expect(names).toContain("m2_prod_foo");
    expect(names).toContain("m2_prod_foo_products");
    expect(names).toContain("m2_prod_foo_products_price_default_asc");
  });
});

describe("mapBldHitToProduct", () => {
  it("maps valid hit with GTIN and CHF price", () => {
    const row = mapBldHitToProduct({
      objectID: "123",
      name: "Test Lamp",
      url: "https://www.beleuchtungdirekt.ch/de/test-lamp",
      sku: "800517",
      ean: "8719157006644",
      in_stock: 1,
      image_url: "https://img.example/a.webp",
      category: "GU10 LED Lampen",
      categories_without_path: ["LED-Lampen", "GU10 LED Lampen"],
      price: { CHF: { default: 0.53 } },
      price_with_tax: { CHF: { default: 0.69 } },
    });
    expect(row).not.toBeNull();
    expect(row?.gtin).toBe("8719157006644");
    expect(row?.priceChf).toBe(0.69);
    expect(row?.inStock).toBe(true);
    expect(row?.productType).toBe("GU10 LED Lampen");
  });

  it("drops hit when ean is not valid GTIN length", () => {
    const row = mapBldHitToProduct({
      objectID: "123",
      name: "Broken",
      url: "https://www.beleuchtungdirekt.ch/de/test-lamp",
      ean: "800517",
    });
    expect(row).toBeNull();
  });
});
