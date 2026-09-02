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
SNL|Snowleader|https://www.snowleader.ch/fr|CHF|snl
REI|Reichelt|https://www.reichelt.com/ch/fr|CHF|rei
FAN|FantasyWelt|https://www.fantasywelt.de|EUR|fan
HAW|Hawk|https://www.hawk.ch|CHF|haw
BWZ|Baby-Walz|https://www.baby-walz.ch/de|CHF|bwz
TUS|The Uncommon Shop|https://theuncommonshop.ch|CHF|tus
ALT|Alternate|https://www.alternate.ch|CHF|alt`;
    const shops = parseScraperShops();
    expect(shops.map((s) => s.key)).toEqual([
      "wel",
      "hhv",
      "snl",
      "rei",
      "fan",
      "haw",
      "bwz",
      "tus",
      "alt",
    ]);
    expect(shops[3].platform).toBe("rei");
    expect(shops[3].currency).toBe("CHF");
    expect(shops[4].platform).toBe("fan");
    expect(shops[4].currency).toBe("EUR");
    expect(shops[4].code).toBe("FAN");
    expect(shops[5].platform).toBe("haw");
    expect(shops[5].currency).toBe("CHF");
    expect(shops[5].code).toBe("HAW");
    expect(shops[6].platform).toBe("bwz");
    expect(shops[6].currency).toBe("CHF");
    expect(shops[6].code).toBe("BWZ");
    expect(shops[7].platform).toBe("tus");
    expect(shops[7].currency).toBe("CHF");
    expect(shops[7].code).toBe("TUS");
    expect(shops[8].platform).toBe("alt");
    expect(shops[8].currency).toBe("CHF");
    expect(shops[8].code).toBe("ALT");
  });
});
