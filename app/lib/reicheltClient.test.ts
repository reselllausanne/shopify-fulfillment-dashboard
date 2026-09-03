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
  isReicheltDelistedHtml,
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

  it("parses CHF thousands with narrow nbsp", () => {
    expect(
      parseReicheltChfPrice('<meta itemprop="price" content="2037.94"><small>(1\u202f906.08\u00a0CHF)</small>', 2037.94)
    ).toBe(1906.08);
  });

  it("parses CHF thousands with apostrophe separators", () => {
    expect(parseReicheltChfPrice("(1'763.26 CHF)", 1885.23)).toBe(1763.26);
  });

  it("rejects absurd CHF when EUR is much lower", () => {
    expect(parseReicheltChfPrice("(368.00 CHF)", 60000)).toBeNull();
  });

  it("parses Swiss space-thousands format inside parens (CORSAIR DDR5 regression)", () => {
    // Real Reichelt CH-FR render: `1 388.93 € (1 300.59 CHF)`.
    // Bug pre-fix: captured "300.59" (0.22× EUR), stored 300 CHF DB → order sold at loss.
    expect(parseReicheltChfPrice("1 388.93 € (1 300.59 CHF)", 1388.93)).toBe(1300.59);
  });

  it("parses NBSP thousands separator", () => {
    expect(parseReicheltChfPrice("(1\u00a0300.59 CHF)", 1388.93)).toBe(1300.59);
  });

  it("parses Swiss apostrophe thousands separator", () => {
    expect(parseReicheltChfPrice("(1'300.59 CHF)", 1388.93)).toBe(1300.59);
  });

  it("rejects CHF far below EUR (parse artifact from dropped leading digit)", () => {
    expect(parseReicheltChfPrice("(300.59 CHF)", 1388.93)).toBeNull();
  });
});

describe("extractReicheltWeightGrams", () => {
  it("parses packaging weight in kg", () => {
    expect(extractReicheltWeightGrams(SAMPLE_PRODUCT_HTML)).toBe(204);
  });

  it("prefers packaging over absurd bare Poids kg", () => {
    const html = `
      <ul><li>Poids</li><li>121 kg</li></ul>
      <ul><li>Poids de l'emballage</li><li>0.2 kg</li></ul>
    `;
    expect(extractReicheltWeightGrams(html)).toBe(200);
  });

  it("treats bare integer kg ≤500 as mislabeled grams", () => {
    const html = `<ul><li>Poids</li><li>121 kg</li></ul>`;
    expect(extractReicheltWeightGrams(html)).toBe(121);
  });
});

describe("sanitizeReicheltShipWeightGrams", () => {
  it("defaults cheap SKUs with 200kg+ scrapes (keyboard-class)", async () => {
    const { sanitizeReicheltShipWeightGrams } = await import("@/app/lib/reicheltPricing");
    const out = sanitizeReicheltShipWeightGrams({ weightGrams: 425000, productChf: 28 });
    expect(out.weightGrams).toBe(500);
    expect(out.weightSource).toBe("default");
  });

  it("caps 50–200kg scrapes at 50kg ship tier (chair/Brio-class)", async () => {
    const { sanitizeReicheltShipWeightGrams } = await import("@/app/lib/reicheltPricing");
    const brio = sanitizeReicheltShipWeightGrams({ weightGrams: 121000, productChf: 74 });
    expect(brio.weightGrams).toBe(50_000);
    expect(brio.weightSource).toBe("capped");
    const chair = sanitizeReicheltShipWeightGrams({ weightGrams: 150000, productChf: 400 });
    expect(chair.weightGrams).toBe(50_000);
  });

  it("caps heavy real freight SKUs at 50kg ship tier", async () => {
    const { sanitizeReicheltShipWeightGrams } = await import("@/app/lib/reicheltPricing");
    const out = sanitizeReicheltShipWeightGrams({ weightGrams: 317000, productChf: 7000 });
    expect(out.weightGrams).toBe(50_000);
    expect(out.weightSource).toBe("capped");
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

  it("does not bake 121kg ship into Brio-class SKUs", () => {
    const cost = computeReicheltLandedCost({
      priceChf: 74.18,
      priceEur: 79.12,
      weightGrams: 121000,
      marginPercent: 30,
    });
    expect(cost).not.toBeNull();
    // No packaging in this path → cap 50kg (next scrape prefers 0.2kg packaging).
    expect(cost!.weightGrams).toBe(50_000);
    expect(cost!.shippingEur).toBe(29.56);
    expect(cost!.sellPriceChf).toBeLessThan(160);
    expect(cost!.sellPriceChf).toBeGreaterThan(100);
  });

  it("uses packaging-scale weight when provided", () => {
    const cost = computeReicheltLandedCost({
      priceChf: 74.18,
      priceEur: 79.12,
      weightGrams: 200,
      marginPercent: 30,
      weightKind: "packaging",
    });
    expect(cost!.weightGrams).toBe(200);
    expect(cost!.shippingEur).toBe(10.21);
    expect(cost!.sellPriceChf).toBeLessThan(120);
  });

  it("falls back to EUR + VAT when CHF missing", () => {
    const resolved = resolveReicheltProductChf({ priceChf: null, priceEur: 10, eurChfRate: 1, vatRate: 0.081 });
    expect(resolved?.productChf).toBe(10.81);
  });
});

describe("isReicheltDelistedHtml", () => {
  it("matches FR plus disponible including malheureusement", () => {
    expect(
      isReicheltDelistedHtml("<b>Cet article n’est malheureusement plus disponible.</b>")
    ).toBe(true);
    expect(isReicheltDelistedHtml("Cet article n'est plus disponible.")).toBe(true);
  });

  it("matches DE/EN discontinued markers", () => {
    expect(isReicheltDelistedHtml("Artikel ist nicht mehr verfügbar")).toBe(true);
    expect(isReicheltDelistedHtml("This product is no longer available")).toBe(true);
    expect(isReicheltDelistedHtml('class="availability status_0"')).toBe(true);
  });

  it("ignores in-stock pages", () => {
    expect(isReicheltDelistedHtml('<div class="availability status_1">ex stock</div>')).toBe(false);
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
