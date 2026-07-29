import { describe, expect, it } from "vitest";
import {
  computeReicheltLandedCost,
  computeReicheltShippingEur,
  extractReicheltWeightGrams,
  resolveReicheltProductChf,
} from "@/app/lib/reicheltPricing";
import {
  parseReicheltChfPrice,
  parseReicheltProductHtml,
  reicheltCategoryPageUrl,
  extractReicheltCategorySlug,
  parseReicheltProductSitemapShards,
  fallbackReicheltProductSitemapShards,
  reicheltAcceptLanguage,
  reicheltReferer,
  toReicheltDeProductUrl,
} from "@/app/lib/reicheltClient";

const SAMPLE_PRODUCT_HTML = `
<html>
<head><link rel="canonical" href="https://www.reichelt.com/ch/fr/shop/produit/cable_test-43378"></head>
<body>
<ul><li>Poids de l'emballage</li><li>0.204 kg</li></ul>
<span itemprop="gtin13">4006381333782</span>
<span itemprop="sku"><b>GW 1,8M SW</b></span>
<meta itemprop="name" content="Câble secteur test">
<span itemprop="brand">Goobay</span>
<meta itemprop="price" content="2.95">
(3.20 CHF)
<div class="availability status_1">En stock</div>
<img itemprop="image" src="https://cdn-reichelt.de/images/test.jpg">
</body>
</html>`;

describe("reicheltAcceptLanguage", () => {
  it("avoids fr-CH primary language that triggers MyraCloud 503 on Node fetch", () => {
    const lang = reicheltAcceptLanguage("https://www.reichelt.com/ch/fr/shop/produit/test-1");
    expect(lang.toLowerCase().startsWith("fr-ch")).toBe(false);
    expect(lang.toLowerCase().startsWith("de-de")).toBe(true);
  });

  it("uses de-DE on reichelt.de", () => {
    expect(reicheltAcceptLanguage("https://www.reichelt.de/de/de/shop/produkt/test-1")).toBe(
      "de-DE,de;q=0.9,en;q=0.8"
    );
  });
});

describe("reicheltReferer", () => {
  it("matches request origin", () => {
    expect(
      reicheltReferer(
        "https://www.reichelt.de/de/de/shop/produkt/test-1",
        "https://www.reichelt.com/ch/fr"
      )
    ).toBe("https://www.reichelt.de/");
  });
});

describe("toReicheltDeProductUrl", () => {
  it("rewrites sitemap product URL to DE slug URL", () => {
    expect(
      toReicheltDeProductUrl(
        "https://www.reichelt.com/de/en/shop/product/unitree_r1_edu_u4_-_humanoid_robot-417249"
      )
    ).toBe(
      "https://www.reichelt.de/de/de/shop/produkt/unitree_r1_edu_u4_-_humanoid_robot-417249"
    );
  });
});

describe("parseReicheltChfPrice", () => {
  it("prefers CHF in parentheses over EUR itemprop", () => {
    expect(parseReicheltChfPrice('itemprop="price" content="2.95"> (3.20 CHF)', 2.95)).toBe(3.2);
  });

  it("rejects absurd CHF when EUR is much lower", () => {
    expect(parseReicheltChfPrice("(368.00 CHF)", 60000)).toBeNull();
  });
});

describe("extractReicheltWeightGrams", () => {
  it("parses packaging weight in kg", () => {
    expect(extractReicheltWeightGrams(SAMPLE_PRODUCT_HTML)).toBe(204);
  });
});

describe("computeReicheltShippingEur", () => {
  it("uses first DPD CH tier up to 10 kg", () => {
    expect(computeReicheltShippingEur(204)).toBe(10.21);
    expect(computeReicheltShippingEur(15_000)).toBe(15.59);
  });
});

describe("computeReicheltLandedCost", () => {
  it("adds shipping and 30% margin", () => {
    const cost = computeReicheltLandedCost({
      priceChf: 3.2,
      priceEur: 2.95,
      weightGrams: 204,
      marginPercent: 30,
    });
    expect(cost).not.toBeNull();
    expect(cost?.productChf).toBe(3.2);
    expect(cost?.shippingEur).toBe(10.21);
    expect(cost?.landedChf).toBeGreaterThan(12);
    expect(cost?.sellPriceChf).toBe(Math.round(cost!.landedChf * 1.3 * 100) / 100);
  });

  it("falls back to EUR + VAT when CHF missing", () => {
    const resolved = resolveReicheltProductChf({ priceChf: null, priceEur: 10, eurChfRate: 1, vatRate: 0.081 });
    expect(resolved?.productChf).toBe(10.81);
  });
});

describe("parseReicheltProductHtml", () => {
  it("parses GTIN, CHF price, weight, breadcrumbs, and stock", () => {
    const product = parseReicheltProductHtml(SAMPLE_PRODUCT_HTML, "43378", "https://www.reichelt.com/ch/fr");
    expect(product).not.toBeNull();
    expect(product?.gtin).toBe("4006381333782");
    expect(product?.priceChf).toBe(3.2);
    expect(product?.weightGrams).toBe(204);
    expect(product?.reicheltSku).toBe("GW 1,8M SW");
    expect(product?.breadcrumbs).toEqual([]);
    expect(product?.inStock).toBe(true);
  });
});

describe("reicheltCategoryPageUrl", () => {
  it("builds PAGE pagination query used by the storefront", () => {
    const url = reicheltCategoryPageUrl(
      "https://www.reichelt.com/ch/fr/shop/cat%C3%A9gorie/gate_driver-10497",
      2
    );
    expect(url).toContain("PAGE=2");
    expect(url).toContain("q=%2Fch%2Ffr%2Fshop%2Fcat");
  });
});

describe("extractReicheltCategorySlug", () => {
  it("strips numeric suffix from category slug", () => {
    expect(
      extractReicheltCategorySlug("https://www.reichelt.com/ch/fr/shop/cat%C3%A9gorie/gate_driver-10497")
    ).toBe("gate driver");
  });
});

describe("parseReicheltProductSitemapShards", () => {
  it("extracts sorted shard numbers from sitemap index", () => {
    const xml = `<urlset><loc>${"https://www.reichelt.com/sitemaps/products/products_2.xml"}</loc><loc>${"https://www.reichelt.com/sitemaps/products/products_10.xml"}</loc></urlset>`;
    expect(parseReicheltProductSitemapShards(xml)).toEqual([2, 10]);
  });

  it("builds blind fallback shard list", () => {
    expect(fallbackReicheltProductSitemapShards(2)).toEqual([0, 1, 2]);
  });
});
