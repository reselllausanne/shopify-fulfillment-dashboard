/**
 * Shared CLI entry — all run-*-scrape.ts scripts use the central runner.
 *
 * Usage:
 *   npx tsx scripts/run-supplier-scrape.ts --shop=haw
 *   npx tsx scripts/run-supplier-scrape.ts --shop=exl --max=50
 */
import "dotenv/config";
import { runScraperJob } from "@/app/lib/scraperRunner";
import { prisma } from "@/app/lib/prisma";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
}

async function main() {
  const shopKey = (arg("shop") || process.argv[2] || "").trim().toLowerCase();
  if (!shopKey) throw new Error("Usage: --shop=<key> [--max=N]");
  const maxRaw = Number(arg("max") || 0);
  const maxProducts = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.floor(maxRaw) : undefined;

  const result = await runScraperJob({
    shopKey,
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
