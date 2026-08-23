import { afterEach, describe, expect, it } from "vitest";
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
  isSoftSkipReicheltShardError,
  normalizeReicheltProxyUrl,
  reicheltShouldSendBrowserHints,
  resolveReicheltPrimaryProductUrl,
  isHardReicheltFetchError,
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

describe("isSoftSkipReicheltShardError", () => {
  it("treats nginx 403/404 shard misses as soft skips", () => {
    expect(isSoftSkipReicheltShardError(new Error("Reichelt HTTP 403 https://x/products_0.xml"))).toBe(
      true
    );
    expect(isSoftSkipReicheltShardError(new Error("Reichelt HTTP 503 https://x/products_1.xml"))).toBe(
      false
    );
  });
});

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

describe("normalizeReicheltProxyUrl", () => {
  it("converts LemonProxy host:port:user:pass into curl proxy URL", () => {
    expect(
      normalizeReicheltProxyUrl(
        "gw-eu.lemonclub.io:5555:pkg-lemonstream-country-ch-session-123-ttl-10:secretpass"
      )
    ).toBe(
      "http://pkg-lemonstream-country-ch-session-123-ttl-10:secretpass@gw-eu.lemonclub.io:5555"
    );
  });

  it("keeps already-normalized http proxy URLs", () => {
    expect(normalizeReicheltProxyUrl("http://user:pass@host:5555")).toBe("http://user:pass@host:5555");
  });
});

describe("resolveReicheltPrimaryProductUrl", () => {
  it("prefers CH-FR slugged sitemap URL over short /-id", () => {
    expect(
      resolveReicheltPrimaryProductUrl(
        "43378",
        "https://www.reichelt.com/de/en/shop/product/cable_test-43378",
        "https://www.reichelt.com/ch/fr"
      )
    ).toBe("https://www.reichelt.com/ch/fr/shop/produit/cable_test-43378");
  });

  it("falls back to short URL only when no productUrl", () => {
    expect(resolveReicheltPrimaryProductUrl("43378", null, "https://www.reichelt.com/ch/fr")).toBe(
      "https://www.reichelt.com/ch/fr/shop/produit/-43378"
    );
  });
});

describe("isHardReicheltFetchError", () => {
  it("treats proxy SSL/tunnel failures as hard", () => {
    expect(isHardReicheltFetchError(new Error("curl: (35) OpenSSL SSL_connect"))).toBe(true);
    expect(isHardReicheltFetchError(new Error("CONNECT tunnel failed, response 504"))).toBe(true);
  });
});

describe("reicheltShouldSendBrowserHints", () => {
  const prevForce = process.env.SCRAPER_REI_FORCE_CURL;
  const prevHints = process.env.SCRAPER_REI_BROWSER_HINTS;

  afterEach(() => {
    if (prevForce === undefined) delete process.env.SCRAPER_REI_FORCE_CURL;
    else process.env.SCRAPER_REI_FORCE_CURL = prevForce;
    if (prevHints === undefined) delete process.env.SCRAPER_REI_BROWSER_HINTS;
    else process.env.SCRAPER_REI_BROWSER_HINTS = prevHints;
  });

  it("defaults off when FORCE_CURL=1", () => {
    process.env.SCRAPER_REI_FORCE_CURL = "1";
    delete process.env.SCRAPER_REI_BROWSER_HINTS;
    expect(reicheltShouldSendBrowserHints()).toBe(false);
  });

  it("can force on via SCRAPER_REI_BROWSER_HINTS=1", () => {
    process.env.SCRAPER_REI_FORCE_CURL = "1";
    process.env.SCRAPER_REI_BROWSER_HINTS = "1";
    expect(reicheltShouldSendBrowserHints()).toBe(true);
  });
});
