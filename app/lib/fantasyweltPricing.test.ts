import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { computeFantasyweltLandedCost, fantasyweltPricingConfig } from "@/app/lib/fantasyweltPricing";
import {
  extractFantasyweltProductUrls,
  isFantasyweltCloudflare,
  isFantasyweltProductPath,
  parseFantasyweltProductHtml,
} from "@/app/lib/fantasyweltClient";

describe("fantasyweltPricing", () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of [
      "SCRAPER_FAN_MARGIN_PERCENT",
      "SCRAPER_FAN_EUR_CHF_RATE",
      "SCRAPER_FAN_SHIPPING_CHF",
      "SCRAPER_FAN_FREE_SHIP_EUR",
    ]) {
      prev[k] = process.env[k];
    }
    process.env.SCRAPER_FAN_MARGIN_PERCENT = "30";
    process.env.SCRAPER_FAN_EUR_CHF_RATE = "1";
    process.env.SCRAPER_FAN_SHIPPING_CHF = "12";
    process.env.SCRAPER_FAN_FREE_SHIP_EUR = "75";
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("applies flat shipping under free-ship threshold + margin", () => {
    const cost = computeFantasyweltLandedCost(29.99);
    expect(cost).not.toBeNull();
    expect(cost!.buyChf).toBe(29.99);
    expect(cost!.shippingChf).toBe(12);
    expect(cost!.landedChf).toBe(41.99);
    expect(cost!.sellPriceChf).toBe(54.59);
    expect(fantasyweltPricingConfig().marginPercent).toBe(30);
  });

  it("zero shipping over free-ship EUR threshold", () => {
    const cost = computeFantasyweltLandedCost(80);
    expect(cost!.shippingChf).toBe(0);
    expect(cost!.sellPriceChf).toBe(104);
  });
});

describe("fantasyweltClient", () => {
  it("detects cloudflare challenge html", () => {
    expect(isFantasyweltCloudflare("<html>Just a moment...</html>")).toBe(true);
    expect(isFantasyweltCloudflare("<html>" + "x".repeat(10_000) + "product-ean</html>")).toBe(false);
  });

  it("accepts product paths and rejects nav stubs", () => {
    expect(isFantasyweltProductPath("Turbo-Flitzpiepen-2000-DE")).toBe(true);
    expect(isFantasyweltProductPath("Neuheiten")).toBe(false);
    expect(isFantasyweltProductPath("foo__bar__baz")).toBe(false);
  });

  it("extracts product urls from listing html", () => {
    const html = `
      <a href="/Turbo-Flitzpiepen-2000-DE">x</a>
      <a href="/Neuheiten">nav</a>
      <a href="https://www.fantasywelt.de/Riffwelten-DE">y</a>
    `;
    const urls = extractFantasyweltProductUrls(html);
    expect(urls).toContain("https://www.fantasywelt.de/Turbo-Flitzpiepen-2000-DE");
    expect(urls).toContain("https://www.fantasywelt.de/Riffwelten-DE");
    expect(urls.some((u) => u.endsWith("/Neuheiten"))).toBe(false);
  });

  it("parses product html with gtin13 microdata", () => {
    const html = `<!DOCTYPE html><html><head>
<title itemprop="name">Turbo-Flitzpiepen 2000 (DE) - FantasyWelt.de, 29,99 €</title>
<meta itemprop="image" content="https://www.fantasywelt.de/media/image/product/225200/lg/x.jpg">
</head><body>
<span itemprop="sku">CMYD0003</span>
<span itemprop="gtin13">3558380140092</span>
<span itemprop="brand" itemscope itemtype="https://schema.org/Brand">
  <strong>Hersteller:</strong>
  <a href="https://www.fantasywelt.de/CMYK">CMYK</a>
</span>
<meta itemprop="price" content="29.99">
<meta itemprop="priceCurrency" content="EUR">
<link itemprop="availability" href="https://schema.org/InStock">
<p>auf Lager · Lieferzeit 1-2 Werktage</p>
<input type="hidden" name="a" value="225200">
</body></html>`;
    const row = parseFantasyweltProductHtml(
      html,
      "https://www.fantasywelt.de/Turbo-Flitzpiepen-2000-DE"
    );
    expect(row?.gtin).toBe("3558380140092");
    expect(row?.priceEur).toBe(29.99);
    expect(row?.sku).toBe("CMYD0003");
    expect(row?.brand).toBe("CMYK");
    expect(row?.availability).toBe("InStock");
  });
});
