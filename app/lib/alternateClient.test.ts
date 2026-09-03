import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import {
  decodePossiblyGzippedXml,
  isAlternateArticleSitemapUrl,
  isAlternateProductUrl,
  normalizeAlternateGtin,
  parseAlternateProductHtml,
} from "@/app/lib/alternateClient";

const SAMPLE_URL =
  "https://www.alternate.ch/goobay/Optisches-Hybrid-Ultra-High-Speed-HDMI-Kabel-AOC-8K-60Hz/html/product/100151565";

describe("normalizeAlternateGtin", () => {
  it("accepts valid EAN-13", () => {
    expect(normalizeAlternateGtin("4040849762741")).toEqual({
      gtin: "4040849762741",
      source: "gtin13",
    });
  });

  it("rejects bad check digit", () => {
    expect(normalizeAlternateGtin("4040849762740")).toBeNull();
  });
});

describe("isAlternateProductUrl", () => {
  it("accepts PDP", () => {
    expect(isAlternateProductUrl(SAMPLE_URL)).toBe(true);
  });

  it("rejects category / home", () => {
    expect(isAlternateProductUrl("https://www.alternate.ch/Hardware")).toBe(false);
    expect(isAlternateProductUrl("https://www.alternate.ch/")).toBe(false);
  });
});

describe("isAlternateArticleSitemapUrl", () => {
  it("keeps article shards", () => {
    expect(isAlternateArticleSitemapUrl("https://www.alternate.ch/sitemap_article1.xml.gz")).toBe(
      true
    );
  });

  it("drops listing shards by article filter (caller also filters listings)", () => {
    expect(isAlternateArticleSitemapUrl("https://www.alternate.ch/sitemap_listings1.xml.gz")).toBe(
      false
    );
  });
});

describe("decodePossiblyGzippedXml", () => {
  it("gunzips sitemap index", () => {
    const xml =
      '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://www.alternate.ch/sitemap_article1.xml.gz</loc></sitemap></sitemapindex>';
    const buf = gzipSync(Buffer.from(xml, "utf8"));
    expect(decodePossiblyGzippedXml(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))).toContain(
      "sitemap_article1"
    );
  });
});

describe("parseAlternateProductHtml", () => {
  it("parses JSON-LD product + gtin8 field", () => {
    const html = `
      <h1>goobay Optisches Hybrid Ultra High-Speed HDMI Kabel (AOC) 8K / 60Hz</h1>
      <script type="application/ld+json">
      {"@context":"https://www.schema.org","@type":"Product","brand":{"@type":"Brand","name":"goobay"},"gtin8":"4040849762741","mpn":"76274","name":"Optisches Hybrid Ultra High-Speed HDMI Kabel (AOC) 8K / 60Hz","sku":100151565,"image":"https://www.alternate.ch/p/600x600/x.jpg","offers":{"@type":"Offer","availability":"InStock","price":"33.99","priceCurrency":"CHF"}}
      </script>
      EAN\t4040849762741
    `;
    const product = parseAlternateProductHtml(html, SAMPLE_URL);
    expect(product?.gtin).toBe("4040849762741");
    expect(product?.gtinSource).toBe("gtin13");
    expect(product?.priceChf).toBe(33.99);
    expect(product?.sku).toBe("100151565");
    expect(product?.articleId).toBe("100151565");
    expect(product?.mpn).toBe("76274");
    expect(product?.brand).toBe("goobay");
    expect(product?.productType).toBe("goobay");
    expect(product?.stock).toBe(5);
    expect(product?.inStock).toBe(true);
    expect(product?.imageUrl).toContain("alternate.ch");
  });

  it("sets stock 0 when OutOfStock", () => {
    const html = `
      <script type="application/ld+json">
      {"@type":"Product","name":"Gone","gtin13":"4040849762741","sku":1,"offers":{"price":10,"availability":"https://schema.org/OutOfStock"}}
      </script>
    `;
    const product = parseAlternateProductHtml(html, SAMPLE_URL);
    expect(product?.stock).toBe(0);
    expect(product?.inStock).toBe(false);
  });

  it("returns null without valid gtin", () => {
    const html = `
      <script type="application/ld+json">
      {"@type":"Product","name":"No EAN","sku":1,"offers":{"price":10,"availability":"https://schema.org/InStock"}}
      </script>
    `;
    expect(parseAlternateProductHtml(html, SAMPLE_URL)).toBeNull();
  });
});
