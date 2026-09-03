import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  nextScraperProxyUrl,
  resetScraperProxyPoolCache,
  scraperProxyPool,
} from "@/app/lib/scraperProxy";

describe("scraperProxy", () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of [
      "SCRAPER_PROXY_FILE",
      "SCRAPER_REI_PROXY_FILE",
      "SCRAPER_PROXY_URLS",
      "SCRAPER_REI_PROXY_URLS",
      "SCRAPER_PROXY_URL",
      "SCRAPER_PROXY",
      "SCRAPER_REI_PROXY_URL",
      "SCRAPER_HAW_PROXY",
    ]) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    resetScraperProxyPoolCache();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetScraperProxyPoolCache();
  });

  it("parses host:port:user:pass into http URL", () => {
    process.env.SCRAPER_PROXY_URLS = "gw.example:5555:user:pass";
    const pool = scraperProxyPool();
    expect(pool).toHaveLength(1);
    expect(pool[0]).toBe("http://user:pass@gw.example:5555/");
  });

  it("shop override beats pool", () => {
    process.env.SCRAPER_PROXY_URLS = "gw.example:5555:user:pass";
    process.env.SCRAPER_HAW_PROXY = "http://haw-proxy:8080";
    resetScraperProxyPoolCache();
    expect(nextScraperProxyUrl("haw")).toBe("http://haw-proxy:8080/");
  });

  it("returns null when no proxies configured", () => {
    expect(scraperProxyPool()).toEqual([]);
    expect(nextScraperProxyUrl("haw")).toBeNull();
  });
});
