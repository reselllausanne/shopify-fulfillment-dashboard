/**
 * Run full Bächli catalog scrape (CLI, no Next server required).
 *
 * Usage:
 *   npx tsx scripts/run-baechli-scrape.ts
 *   npx tsx scripts/run-baechli-scrape.ts --max=500
 */
import "dotenv/config";
import { findScraperShop } from "@/app/lib/scraperShops";
import { hasRunningRun, recoverStaleRuns, scrapeBaechliShop, startRun } from "@/app/lib/baechliScrape";
import { prisma } from "@/app/lib/prisma";

const maxArg = process.argv.find((a) => a.startsWith("--max="));
const maxProducts = maxArg ? Math.max(1, Number(maxArg.split("=")[1] || 0)) : undefined;

async function main() {
  await recoverStaleRuns(Number(process.env.SCRAPER_STALE_RUN_MINUTES || 90));
  const shop = findScraperShop("bae");
  if (!shop) throw new Error("BAE not configured in SCRAPER_SHOPS");

  if (await hasRunningRun(shop.key)) {
    console.log(JSON.stringify({ ok: false, error: "bae scrape already running" }));
    return;
  }

  const runId = await startRun(shop);
  console.log(JSON.stringify({ ok: true, shop: shop.key, runId, maxProducts: maxProducts ?? null }));
  await scrapeBaechliShop(shop, runId, maxProducts);
  const count = await prisma.supplierVariant.count({
    where: { supplierVariantId: { startsWith: "bae_" } },
  });
  console.log(JSON.stringify({ ok: true, runId, baeRows: count }));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
