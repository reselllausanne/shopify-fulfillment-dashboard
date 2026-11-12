/**
 * One-shot: KickDB price/stock refresh for recent Galaxus STX hot sellers.
 * Usage: npx tsx scripts/stx-hot-sellers-refresh.ts
 */
import "dotenv/config";
import { prisma } from "../app/lib/prisma";
import { runStxHotSellersRefresh } from "../galaxus/jobs/stxHotSellersRefresh";

async function main() {
  const result = await runStxHotSellersRefresh();
  console.log("[stx-hot-sellers-refresh]", JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
