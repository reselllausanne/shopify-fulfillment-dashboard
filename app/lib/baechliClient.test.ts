import { describe, expect, it } from "vitest";
import {
  extractBaechliArticleNumber,
  isBaechliProductUrl,
  isBaechliVariantSkuForArticle,
  normalizeBaechliBarcode,
  parseBaechliProductHtml,
  shouldSkipBaechliGtin,
} from "@/app/lib/baechliClient";

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

describe("isBaechliProductUrl", () => {
  it("accepts real product URLs", () => {
    expect(
      isBaechliProductUrl(
        "https://www.baechli-bergsport.ch/de/damen/shirts/tops/mammut-111114-massone-light-tank-top-w"
      )
    ).toBe(true);
  });

  it("rejects books/maps category", () => {
    expect(
      isBaechliProductUrl(
        "https://www.baechli-bergsport.ch/de/ausrustung/bucher-karten/karten/topokarten/swisstopo-12201-lk-1293-oso"
      )
    ).toBe(false);
  });
});

describe("parseBaechliProductHtml", () => {
  const productUrl =
    "https://www.baechli-bergsport.ch/de/ausrustung/camping/nahrung/energie-food/clif-bar-113001-peanut-muesli-mix";

  it("parses variant sku, price, and gtin12 from JSON-LD", () => {
    const html = `
      <h1>Peanut Muesli Mix</h1>
      <ol class="msw-breadcrumb"><span itemprop="name">Ausrüstung</span><span itemprop="name">Camping</span></ol>
      <div data-variantname="68 g" data-variantnumber="113001-001" data-price="3.40"></div>
      {"@type": "Product","sku": "113001-001","name": "Peanut Muesli Mix 68 g","size": "68 g","gtin12": "722252071569","image": "https://example.test/113001.jpg","offers": {  "@type": "Offer",  "priceCurrency": "CHF",  "price": 3.40,  "availability": "http://schema.org/InStock"}}
    `;
    const product = parseBaechliProductHtml(html, productUrl);
    expect(product?.name).toBe("Peanut Muesli Mix");
    expect(product?.variants).toHaveLength(1);
    expect(product?.variants[0].sku).toBe("113001-001");
    expect(product?.variants[0].gtin).toBe("722252071569");
    expect(product?.variants[0].gtinSource).toBe("gtin12");
    expect(product?.variants[0].priceChf).toBe(3.4);
  });

  it("drops cross-sell SKUs that do not match page article", () => {
    const html = `
      <h1>Main Shoe</h1>
      <div data-variantnumber="113001-001" data-price="3.40"></div>
      <div data-variantnumber="999999-001" data-price="99.00"></div>
      {"@type": "Product","sku": "113001-001","gtin13": "5053817373671","offers": {"price": 3.40}}
      {"@type": "Product","sku": "999999-001","gtin13": "7616185347439","offers": {"price": 99.00}}
    `;
    const product = parseBaechliProductHtml(html, productUrl);
    expect(product?.variants.map((v) => v.sku)).toEqual(["113001-001"]);
  });

  it("skips ISBN gtins by default", () => {
    expect(shouldSkipBaechliGtin("9783302012841")).toBe(true);
    expect(shouldSkipBaechliGtin("5053817373671")).toBe(false);
  });
});

describe("extractBaechliArticleNumber", () => {
  it("reads article id from slug", () => {
    expect(extractBaechliArticleNumber("https://x/de/a/b/c/odlo-108363-seamless"))?.toBe("108363");
    expect(isBaechliVariantSkuForArticle("108363-002", "108363")).toBe(true);
    expect(isBaechliVariantSkuForArticle("999999-002", "108363")).toBe(false);
  });
});
