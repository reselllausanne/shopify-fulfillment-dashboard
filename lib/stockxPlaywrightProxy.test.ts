import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetScraperProxyPoolCache, scraperProxyPool } from "@/app/lib/scraperProxy";
import {
  nextStockxPlaywrightProxy,
  parsePlaywrightProxyUrl,
  resetStockxProxyFilePoolCache,
  stockxPlaywrightProxyAvailable,
  stockxProxyFilePool,
} from "@/lib/stockxPlaywrightProxy";

describe("parsePlaywrightProxyUrl", () => {
  it("parses host:port:user:pass (LemonProxy)", () => {
    const p = parsePlaywrightProxyUrl(
      "gw-eu.lemonclub.io:5555:pkg-user-country-de:secret:with:colons"
    );
    expect(p).toEqual({
      server: "http://gw-eu.lemonclub.io:5555",
      username: "pkg-user-country-de",
      password: "secret:with:colons",
      label: "gw-eu.lemonclub.io:5555",
    });
  });

  it("parses http URL with credentials", () => {
    const p = parsePlaywrightProxyUrl("http://u%40x:p%40ss@proxy.example:8080");
    expect(p?.server).toBe("http://proxy.example:8080");
    expect(p?.username).toBe("u@x");
    expect(p?.password).toBe("p@ss");
  });

  it("returns null for empty", () => {
    expect(parsePlaywrightProxyUrl("")).toBeNull();
  });
});

describe("STOCKX_PROXY_FILE pool", () => {
  const prev: Record<string, string | undefined> = {};
  let tmpFile = "";
  let scraperFile = "";

  beforeEach(() => {
    for (const k of [
      "STOCKX_PROXY_FILE",
      "STOCKX_PROXY_URLS",
      "STOCKX_PROXY",
      "STOCKX_PROXY_URL",
      "STOCKX_PROXY_SERVER",
      "STOCKX_PROXY_USERNAME",
      "STOCKX_PROXY_PASSWORD",
      "STOCKX_PROXY_COUNTRY",
      "STOCKX_BROWSER_PROXY_MODE",
      "SCRAPER_PROXY_FILE",
      "SCRAPER_PROXY_URLS",
      "SCRAPER_PROXY_URL",
      "SCRAPER_PROXY",
    ]) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    resetStockxProxyFilePoolCache();
    resetScraperProxyPoolCache();

    tmpFile = path.join(
      os.tmpdir(),
      `stockx-proxies-${process.pid}-${Date.now()}.txt`
    );
    scraperFile = path.join(
      os.tmpdir(),
      `scraper-proxies-${process.pid}-${Date.now()}.txt`
    );
    fs.writeFileSync(
      tmpFile,
      [
        "gw.example:5555:pkg-lemonprime-country-ch-session-111:pass1",
        "gw.example:5555:pkg-lemonprime-country-ch-session-222:pass2",
        "gw.example:5555:pkg-lemonprime-country-de-session-333:pass3",
      ].join("\n")
    );
    fs.writeFileSync(
      scraperFile,
      "gw.scraper:5555:pkg-scraper-country-de-session-999:scrapepass\n"
    );
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetStockxProxyFilePoolCache();
    resetScraperProxyPoolCache();
    for (const f of [tmpFile, scraperFile]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  });

  it("reads multi-line STOCKX_PROXY_FILE and round-robins stickies", () => {
    process.env.STOCKX_PROXY_FILE = tmpFile;
    process.env.STOCKX_PROXY_COUNTRY = "ch";
    // Interim single STOCKX_PROXY must NOT pin when file pool exists.
    process.env.STOCKX_PROXY =
      "gw.example:5555:pkg-lemonprime-country-ch-session-LOCKED:lockedpass";

    const pool = stockxProxyFilePool();
    expect(pool).toHaveLength(3);

    const a = nextStockxPlaywrightProxy();
    const b = nextStockxPlaywrightProxy();
    expect(a?.username).toContain("session-111");
    expect(b?.username).toContain("session-222");
    expect(a?.username).not.toBe(b?.username);
    expect(stockxPlaywrightProxyAvailable()).toBe(true);
  });

  it("does not read or mutate SCRAPER_PROXY_FILE when StockX file set", () => {
    process.env.STOCKX_PROXY_FILE = tmpFile;
    process.env.SCRAPER_PROXY_FILE = scraperFile;

    const stockx = nextStockxPlaywrightProxy();
    expect(stockx?.username).toContain("lemonprime");
    expect(stockx?.username).not.toContain("scraper");

    // Reichelt pool still independent.
    resetScraperProxyPoolCache();
    const scraper = scraperProxyPool();
    expect(scraper).toHaveLength(1);
    expect(scraper[0]).toContain("scrapepass");
  });

  it("falls back to single STOCKX_PROXY when file empty/missing", () => {
    process.env.STOCKX_PROXY_FILE = "/tmp/does-not-exist-stockx-proxies.txt";
    process.env.STOCKX_PROXY =
      "gw.example:5555:pkg-lemonprime-country-ch-session-solo:solopass";
    const p = nextStockxPlaywrightProxy();
    expect(p?.username).toContain("session-solo");
  });
});
