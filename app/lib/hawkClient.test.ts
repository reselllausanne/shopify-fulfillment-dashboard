import { describe, expect, it } from "vitest";
import {
  isHawkExcludedPath,
  isHawkProductUrl,
  normalizeHawkGtin,
  parseHawkProductHtml,
} from "@/app/lib/hawkClient";

const SAMPLE_URL =
  "https://www.hawk.ch/spielwaren/lego-r-speed-champions-2-fast-2-furious-nissan-skyline-gt-r-76917.html";

describe("normalizeHawkGtin", () => {
  it("accepts valid EAN-13", () => {
    expect(normalizeHawkGtin("5702017424217")).toEqual({
      gtin: "5702017424217",
      source: "gtin13",
    });
  });

  it("rejects bad check digit", () => {
    expect(normalizeHawkGtin("5702017424210")).toBeNull();
  });
});

describe("isHawkProductUrl", () => {
  it("accepts Magento PDP", () => {
    expect(isHawkProductUrl(SAMPLE_URL)).toBe(true);
  });

  it("keeps adult category by default", () => {
    expect(isHawkProductUrl("https://www.hawk.ch/erotik/tenga-flip-zero-0-gravity-gentle.html")).toBe(
      true
    );
  });

  it("rejects category / CMS urls", () => {
    expect(isHawkProductUrl("https://www.hawk.ch/spielwaren")).toBe(false);
    expect(isHawkProductUrl("https://www.hawk.ch/")).toBe(false);
  });
});

describe("isHawkExcludedPath", () => {
  it("respects env exclude prefixes only", () => {
    expect(isHawkExcludedPath("/erotik/foo")).toBe(false);
    expect(isHawkExcludedPath("/erotik/foo", ["/erotik"])).toBe(true);
    expect(isHawkExcludedPath("/spielwaren/lego.html", ["/erotik"])).toBe(false);
  });
});

describe("parseHawkProductHtml", () => {
  it("parses JSON-LD product + stock qty", () => {
    const html = `
      <h1>LEGO Speed Champions Nissan</h1>
      <input type="hidden" name="product" value="86398" />
      <div class="stock available selabel-qty" id="stock-label-qty">
        Stück an Lager: <span style="margin: 0">1</span></div>
      <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Product","name":"LEGO ® Speed Champions - 2 Fast 2 Furious Nissan Skyline GT-R  - 76917","image":"https://www.hawk.ch/media/catalog/product/x.jpg","offers":[{"@type":"Offer","priceCurrency":"CHF","price":59.96,"availability":"https://schema.org/InStock","gtin":"5702017424217","mpn":"76917"}],"brand":{"@type":"Brand","name":"Lego"},"mpn":"76917","gtin":"5702017424217"}
      </script>
    `;
    const product = parseHawkProductHtml(html, SAMPLE_URL);
    expect(product?.gtin).toBe("5702017424217");
    expect(product?.gtinSource).toBe("gtin13");
    expect(product?.priceChf).toBe(59.96);
    expect(product?.sku).toBe("76917");
    expect(product?.mpn).toBe("76917");
    expect(product?.magentoProductId).toBe("86398");
    expect(product?.brand).toBe("Lego");
    expect(product?.productType).toBe("spielwaren");
    expect(product?.stock).toBe(1);
    expect(product?.inStock).toBe(true);
    expect(product?.imageUrl).toContain("hawk.ch/media");
  });

  it("sets stock 0 when OutOfStock", () => {
    const html = `
      <script type="application/ld+json">
      {"@type":"Product","name":"Gone","gtin":"5702017424217","offers":{"price":10,"availability":"https://schema.org/OutOfStock"}}
      </script>
    `;
    const product = parseHawkProductHtml(html, SAMPLE_URL);
    expect(product?.stock).toBe(0);
    expect(product?.inStock).toBe(false);
  });

  it("returns null without valid gtin", () => {
    const html = `
      <script type="application/ld+json">
      {"@type":"Product","name":"No EAN","offers":{"price":10,"availability":"https://schema.org/InStock"}}
      </script>
    `;
    expect(parseHawkProductHtml(html, SAMPLE_URL)).toBeNull();
  });
});
