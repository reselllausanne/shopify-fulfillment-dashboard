import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { parseScraperShops } from "@/app/lib/scraperShops";

describe("parseScraperShops", () => {
  const prev = process.env.SCRAPER_SHOPS;
  const prevAllow = process.env.GALAXUS_FEED_SUPPLIER_ALLOWLIST;

  beforeEach(() => {
    process.env.GALAXUS_FEED_SUPPLIER_ALLOWLIST = "wel";
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.SCRAPER_SHOPS;
    else process.env.SCRAPER_SHOPS = prev;
    if (prevAllow === undefined) delete process.env.GALAXUS_FEED_SUPPLIER_ALLOWLIST;
    else process.env.GALAXUS_FEED_SUPPLIER_ALLOWLIST = prevAllow;
  });

  it("parses comma-separated shops", () => {
    process.env.SCRAPER_SHOPS =
      "WEL|WellPlayed|https://www.wellplayed.ch,HHV|HHV|https://www.hhv.de|EUR|hhv";
    const shops = parseScraperShops();
    expect(shops.map((s) => s.key)).toEqual(["wel", "hhv"]);
    expect(shops[1].platform).toBe("hhv");
    expect(shops[1].currency).toBe("EUR");
  });

  it("parses one shop per line", () => {
    process.env.SCRAPER_SHOPS = `WEL|WellPlayed|https://www.wellplayed.ch
HHV|HHV|https://www.hhv.de|EUR|hhv
SNL|Snowleader|https://www.snowleader.ch/fr|CHF|snl`;
    const shops = parseScraperShops();
    expect(shops.map((s) => s.key)).toEqual(["wel", "hhv", "snl"]);
    expect(shops[2].platform).toBe("snl");
    expect(shops[2].gated).toBe(true);
    expect(shops[0].gated).toBe(false);
  });
});
