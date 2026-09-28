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
      "WEL|WellPlayed|https://www.wellplayed.ch,FAN|FantasyWelt|https://www.fantasywelt.de|EUR|fan";
    const shops = parseScraperShops();
    expect(shops.map((s) => s.key)).toEqual(["wel", "fan"]);
    expect(shops[1].platform).toBe("fan");
    expect(shops[1].currency).toBe("EUR");
  });

  it("parses one shop per line", () => {
    process.env.SCRAPER_SHOPS = `WEL|WellPlayed|https://www.wellplayed.ch
REI|Reichelt|https://www.reichelt.com/ch/fr|CHF|rei
FAN|FantasyWelt|https://www.fantasywelt.de|EUR|fan
HAW|Hawk|https://www.hawk.ch|CHF|haw
BWZ|Baby-Walz|https://www.baby-walz.ch/de|CHF|bwz
TUS|The Uncommon Shop|https://theuncommonshop.ch|CHF|tus
ALT|Alternate|https://www.alternate.ch|CHF|alt
VEN|Venova|https://www.venova.ch/de|CHF|ven`;
    const shops = parseScraperShops();
    expect(shops.map((s) => s.key)).toEqual([
      "wel",
      "rei",
      "fan",
      "haw",
      "bwz",
      "tus",
      "alt",
      "ven",
    ]);
    expect(shops[1].platform).toBe("rei");
    expect(shops[2].platform).toBe("fan");
    expect(shops[2].code).toBe("FAN");
    expect(shops[3].platform).toBe("haw");
    expect(shops[4].platform).toBe("bwz");
    expect(shops[5].platform).toBe("tus");
    expect(shops[6].platform).toBe("alt");
    expect(shops[7].platform).toBe("ven");
  });

  it("ignores killed BAE/HHV/SNL/NSO entries in SCRAPER_SHOPS", () => {
    process.env.SCRAPER_SHOPS =
      "WEL|WellPlayed|https://www.wellplayed.ch,BAE|Bächli|https://www.baechli-bergsport.ch/de|CHF|bae,HHV|HHV|https://www.hhv.de|EUR|hhv,SNL|Snowleader|https://www.snowleader.ch/fr|CHF|snl,NSO|Newsole|https://www.newsole.ch|CHF|nso,FAN|FantasyWelt|https://www.fantasywelt.de|EUR|fan";
    const shops = parseScraperShops();
    expect(shops.map((s) => s.key)).toEqual(["wel", "fan"]);
  });
});
