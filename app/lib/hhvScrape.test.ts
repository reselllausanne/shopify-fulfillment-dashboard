import { describe, expect, it } from "vitest";
import {
  buildEligibleRecords,
  buildKickdbSearchQueries,
  buildStyleGtinIndex,
  computeHhvLandedCost,
  extractProductFromJsonLd,
  extractSizeVariants,
  extractWeightGrams,
  isHhvSneakerProduct,
  resolveGtinsFromStyleIndex,
  sizesMatch,
} from "@/app/lib/hhvScrape";
import type { ScraperShop } from "@/app/lib/scraperShops";

const shop: ScraperShop = {
  key: "hhv",
  code: "HHV",
  name: "HHV",
  baseUrl: "https://www.hhv.de/de-CH",
  currency: "CHF",
  platform: "hhv",
  gated: true,
};

describe("hhvScrape parsers", () => {
  it("extracts product JSON-LD with CHF", () => {
    const html = `
      <script type="application/ld+json">
      {"@context":"http://schema.org","@graph":[{"@type":"Product","name":"adidas - Samba OG - 43","brand":{"@type":"Brand","name":"adidas"},"mpn":"KK2268","gtin":"04068818049105","category":"HHV Clothing > Schuhe > Sneaker","image":"https://cdn.example/1.webp","offers":[{"@type":"Offer","price":111.17,"priceCurrency":"CHF","availability":"http://schema.org/InStock"}]}]}
      </script>
      Gewicht: 250g (plus 250g Verpackung)`;
    const meta = extractProductFromJsonLd(html);
    expect(meta?.brand).toBe("adidas");
    expect(meta?.price).toBe(111.17);
    expect(meta?.priceCurrency).toBe("CHF");
    expect(meta?.weightGrams).toBe(250);
    expect(isHhvSneakerProduct(meta)).toBe(true);
  });

  it("extracts shoe size buttons", () => {
    const html = `
      <div class="size inactive" data-value="1393334v1"><span class="title">37⅓</span></div>
      <div class="size " data-value="1393334v8"><span class="title">42</span></div>`;
    const sizes = extractSizeVariants(html);
    expect(sizes).toHaveLength(2);
    expect(sizes[1]).toMatchObject({ sku: "1393334v8", label: "42", available: true });
  });

  it("computes landed cost with shipping and fees", () => {
    process.env.SCRAPER_HHV_SHIPPING_CHF = "8";
    process.env.SCRAPER_HHV_FEE_PERCENT = "2.5";
    process.env.SCRAPER_HHV_FEE_FLAT_CHF = "1";
    const cost = computeHhvLandedCost(100);
    expect(cost.landedPriceChf).toBe(111.5);
  });

  it("uses per-size kickdb gtin while keeping hhv sku row id", () => {
    const meta = {
      name: "adidas Samba OG",
      brand: "adidas",
      mpn: "KK2268",
      image: "https://cdn.example/1.webp",
      category: "HHV Clothing > Sneaker",
      price: 111.17,
      priceCurrency: "CHF",
      pageGtin: "04068818049105",
      gender: "Herren",
      weightGrams: 250,
    };
    const sizes = [
      { sku: "1393334v8", label: "42", available: true },
      { sku: "1393334v9", label: "42⅔", available: true },
    ];
    process.env.SCRAPER_HHV_SHIPPING_CHF = "0";
    process.env.SCRAPER_HHV_FEE_PERCENT = "0";
    process.env.SCRAPER_HHV_FEE_FLAT_CHF = "0";
    const gtinBySku = new Map([
      ["1393334v8", "4068818049105"],
      ["1393334v9", "4068818049204"],
    ]);
    const gtinSourceBySku = new Map([
      ["1393334v8", "kickdb"],
      ["1393334v9", "kickdb"],
    ]);
    const rows = buildEligibleRecords(shop, meta, sizes, "https://www.hhv.de/de-CH/clothing/artikel/test-1", gtinBySku, gtinSourceBySku);
    expect(rows).toHaveLength(2);
    expect(rows[0].supplierVariantId).toBe("hhv_1393334v8");
    expect(rows[0].gtin).toBe("4068818049105");
    expect(rows[0].providerKey).toBe("HHV_4068818049105");
    expect(rows[1].gtin).toBe("4068818049204");
    expect(JSON.parse(rows[0].manualNote).gtinSource).toBe("kickdb");
  });

  it("does not copy page gtin to every size when kickdb missing", () => {
    const meta = {
      name: "adidas Samba OG",
      brand: "adidas",
      mpn: "KK2268",
      image: null,
      category: "HHV Clothing > Sneaker",
      price: 111.17,
      priceCurrency: "CHF",
      pageGtin: "04068818049105",
      gender: "Herren",
      weightGrams: null,
    };
    const sizes = [
      { sku: "1393334v8", label: "42", available: true },
      { sku: "1393334v9", label: "42⅔", available: true },
    ];
    const rows = buildEligibleRecords(shop, meta, sizes, "https://example.test/p", new Map());
    expect(rows.every((r) => r.gtin === null)).toBe(true);
    expect(rows.every((r) => r.mappingStatus === "PENDING_GTIN")).toBe(true);
  });

  it("matches gtin from existing supplier style code + size", () => {
    const meta = {
      name: "adidas Samba OG",
      brand: "adidas",
      mpn: "KK2268",
      image: null,
      category: "Sneaker",
      price: 111.17,
      priceCurrency: "CHF",
      pageGtin: "04068818049105",
      gender: "Herren",
      weightGrams: null,
    };
    const sizes = [
      { sku: "1393334v8", label: "42", available: true },
      { sku: "1393334v9", label: "42⅔", available: true },
    ];
    const index = buildStyleGtinIndex([
      { styleCode: "KK2268", sizeRaw: "42", gtin: "4068818049105" },
      { styleCode: "KK2268", sizeRaw: "42 2/3", gtin: "4068818049204" },
    ]);
    const gtins = resolveGtinsFromStyleIndex(meta, sizes, index);
    expect(gtins.get("1393334v8")).toBe("4068818049105");
    expect(gtins.get("1393334v9")).toBe("4068818049204");
    expect(sizesMatch("42⅔", "42 2/3")).toBe(true);
  });

  it("builds kickdb search queries from mpn and title", () => {
    const queries = buildKickdbSearchQueries({
      name: "adidas - Samba OG - 43",
      brand: "adidas",
      mpn: "KK2268",
      image: null,
      category: "Sneaker",
      price: 100,
      priceCurrency: "CHF",
      pageGtin: null,
      gender: null,
      weightGrams: null,
    });
    expect(queries).toContain("KK2268");
    expect(queries).toContain("adidas Samba OG");
  });

  it("extracts weight from artikel details", () => {
    expect(extractWeightGrams("Gewicht:\t2500g (plus Verpackung)")).toBe(2500);
  });
});
