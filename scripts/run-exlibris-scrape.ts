/**
 * Run Ex Libris listing scrape (CLI) — upserts SupplierVariant like REI.
 */
import "dotenv/config";
import { findScraperShop } from "@/app/lib/scraperShops";
import {
  hasRunningRun,
  recoverStaleRuns,
  scrapeExlibrisShop,
  startRun,
} from "@/app/lib/exlibrisScrape";
import { prisma } from "@/app/lib/prisma";

const maxArg = process.argv.find((a) => a.startsWith("--max="));
const maxProducts = maxArg ? Math.max(1, Number(maxArg.split("=")[1] || 0)) : undefined;

async function main() {
  await recoverStaleRuns(Number(process.env.SCRAPER_STALE_RUN_MINUTES || 1440));
  const shop = findScraperShop("exl");
  if (!shop) throw new Error("EXL not configured in SCRAPER_SHOPS");

  if (await hasRunningRun(shop.key)) {
    console.log(JSON.stringify({ ok: false, error: "exl scrape already running" }));
    return;
  }

  const runId = await startRun(shop);
  console.log(JSON.stringify({ ok: true, shop: shop.key, runId, maxProducts: maxProducts ?? null }));
  await scrapeExlibrisShop(shop, runId, maxProducts);
  const count = await prisma.supplierVariant.count({
    where: { supplierVariantId: { startsWith: "exl_" } },
  });
  console.log(JSON.stringify({ ok: true, runId, exlRows: count }));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
