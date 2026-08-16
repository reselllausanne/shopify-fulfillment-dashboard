/**
 * Run Snowleader GraphQL scrape (CLI). Prefer local Mac when VPS IP is CF-blocked.
 *
 * Usage:
 *   npx tsx scripts/run-snl-scrape.ts
 *   npx tsx scripts/run-snl-scrape.ts --max=50
 */
import "dotenv/config";
import { findScraperShop } from "@/app/lib/scraperShops";
import {
  hasRunningRun,
  recoverStaleRuns,
  scrapeSnowleaderShop,
  startRun,
} from "@/app/lib/snowleaderScrape";
import { prisma } from "@/app/lib/prisma";

const maxArg = process.argv.find((a) => a.startsWith("--max="));
const maxProducts = maxArg ? Math.max(1, Number(maxArg.split("=")[1] || 0)) : undefined;

async function main() {
  await recoverStaleRuns(Number(process.env.SCRAPER_STALE_RUN_MINUTES || 90));
  const shop = findScraperShop("snl");
  if (!shop) throw new Error("SNL not configured in SCRAPER_SHOPS");

  if (await hasRunningRun(shop.key)) {
    console.log(JSON.stringify({ ok: false, error: "snl scrape already running" }));
    return;
  }

  const runId = await startRun(shop);
  console.log(JSON.stringify({ ok: true, shop: shop.key, runId, maxProducts: maxProducts ?? null }));
  await scrapeSnowleaderShop(shop, runId, maxProducts);
  const count = await prisma.supplierVariant.count({
    where: { supplierVariantId: { startsWith: "snl_" } },
  });
  console.log(JSON.stringify({ ok: true, runId, snlRows: count }));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
