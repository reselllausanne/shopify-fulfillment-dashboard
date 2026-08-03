import { describe, expect, it } from "vitest";
import { normalizeBaechliBarcode, parseBaechliProductHtml } from "@/app/lib/baechliClient";

describe("normalizeBaechliBarcode", () => {
  it("prefers gtin13 over gtin12", () => {
    const out = normalizeBaechliBarcode({
      gtin13: "5053817373671",
      gtin12: "053817373671",
    });
    expect(out?.source).toBe("gtin13");
    expect(out?.gtin).toBe("5053817373671");
  });

  it("accepts valid gtin12 UPC-A when no EAN present", () => {
    const out = normalizeBaechliBarcode({ gtin12: "722252071569" });
    expect(out?.source).toBe("gtin12");
    expect(out?.gtin).toBe("722252071569");
  });

  it("rejects invalid check digit", () => {
    expect(normalizeBaechliBarcode({ gtin13: "5053817373670" })).toBeNull();
  });
});

describe("parseBaechliProductHtml", () => {
  it("parses variant sku, price, and gtin12 from JSON-LD", () => {
    const html = `
      <h1>Peanut Muesli Mix</h1>
      <ol class="msw-breadcrumb"><span itemprop="name">Ausrüstung</span><span itemprop="name">Camping</span></ol>
      <div data-variantname="68 g" data-variantnumber="113001-001" data-price="3.40"></div>
      {"@type": "Product","sku": "113001-001","name": "Peanut Muesli Mix 68 g","size": "68 g","gtin12": "722252071569","image": "https://example.test/113001.jpg","offers": {  "@type": "Offer",  "priceCurrency": "CHF",  "price": 3.40,  "availability": "http://schema.org/InStock"}}
    `;
    const product = parseBaechliProductHtml(html, "https://example.test/p");
    expect(product?.name).toBe("Peanut Muesli Mix");
    expect(product?.variants).toHaveLength(1);
    expect(product?.variants[0].sku).toBe("113001-001");
    expect(product?.variants[0].gtin).toBe("722252071569");
    expect(product?.variants[0].gtinSource).toBe("gtin12");
    expect(product?.variants[0].priceChf).toBe(3.4);
  });
});
