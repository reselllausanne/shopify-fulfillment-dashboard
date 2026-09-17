/**
 * CLI scrape for bae — routes through central runner (finalize once).
 * Prefer: npx tsx scripts/run-supplier-scrape.ts --shop=bae
 */
import "dotenv/config";
import { runScraperJob } from "@/app/lib/scraperRunner";
import { prisma } from "@/app/lib/prisma";

const maxArg = process.argv.find((a) => a.startsWith("--max="));
const maxProducts = maxArg ? Math.max(1, Number(maxArg.split("=")[1] || 0)) : undefined;

async function main() {
  const result = await runScraperJob({
    shopKey: "bae",
    maxProducts,
    background: false,
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
