/**
 * CLI scrape for rei — routes through central runner (finalize once).
 * Prefer: npx tsx scripts/run-supplier-scrape.ts --shop=rei
 * --sweep-only: re-check stale + priority (limited qty / high price) in-stock rows, no sitemap crawl.
 */
import "dotenv/config";
import { runScraperJob } from "@/app/lib/scraperRunner";
import { prisma } from "@/app/lib/prisma";

const maxArg = process.argv.find((a) => a.startsWith("--max="));
const maxProducts = maxArg ? Math.max(1, Number(maxArg.split("=")[1] || 0)) : undefined;
const sweepOnly = process.argv.includes("--sweep-only");
if (sweepOnly) process.env.SCRAPER_REI_SWEEP_ONLY = "1";

async function main() {
  const result = await runScraperJob({
    shopKey: "rei",
    maxProducts,
    background: false,
    ...(sweepOnly
      ? { snapshotCompleteness: "partial" as const, incompletenessReason: "rei_sweep_only" }
      : {}),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
