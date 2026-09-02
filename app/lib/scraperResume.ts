import { findScraperShop, parseScraperShops } from "@/app/lib/scraperShops";
import { scraperQuery } from "@/app/lib/scraperDb";
import { hasRunningRun, startRun, scrapeShop } from "@/app/lib/shopifyScrape";
import { scrapeHhvShop } from "@/app/lib/hhvScrape";
import { scrapeSnowleaderShop } from "@/app/lib/snowleaderScrape";
import { scrapeReicheltShop } from "@/app/lib/reicheltScrape";
import { scrapeNewsoleShop } from "@/app/lib/newsoleScrape";
import { scrapeBaechliShop } from "@/app/lib/baechliScrape";
import { scrapeFantasyweltShop } from "@/app/lib/fantasyweltScrape";
import { scrapeExlibrisShop } from "@/app/lib/exlibrisScrape";
import { scrapeHawkShop } from "@/app/lib/hawkScrape";
import type { ScraperShop } from "@/app/lib/scraperShops";

function runScrapeForShop(shop: ScraperShop, runId: number) {
  const runScrape =
    shop.platform === "hhv"
      ? scrapeHhvShop
      : shop.platform === "snl"
        ? scrapeSnowleaderShop
        : shop.platform === "rei"
          ? scrapeReicheltShop
          : shop.platform === "nso"
            ? scrapeNewsoleShop
            : shop.platform === "bae"
              ? scrapeBaechliShop
              : shop.platform === "fan"
                ? scrapeFantasyweltShop
                : shop.platform === "exl"
                  ? scrapeExlibrisShop
                  : shop.platform === "haw"
                    ? scrapeHawkShop
                    : scrapeShop;
  return runScrape(shop, runId);
}

/** Restart scrapes whose latest run was cut off by a container restart (partial data already committed). */
export async function resumeInterruptedScrapes(): Promise<string[]> {
  const rows = await scraperQuery<{ shop_id: string }>(
    `SELECT shop_id
       FROM (
         SELECT DISTINCT ON (shop_id) shop_id, status
           FROM scraper.scrape_runs
          ORDER BY shop_id, started_at DESC
       ) latest
      WHERE status = 'interrupted'`
  );

  const started: string[] = [];
  for (const { shop_id } of rows) {
    const shop = findScraperShop(shop_id) ?? parseScraperShops().find((s) => s.key === shop_id);
    if (!shop) continue;
    if (await hasRunningRun(shop.key)) continue;
    const runId = await startRun(shop);
    started.push(shop.key);
    void runScrapeForShop(shop, runId).catch((e) => {
      console.error(`[SCRAPER] auto-resume ${shop.key} run#${runId} failed:`, e?.message || e);
    });
  }
  return started;
}
