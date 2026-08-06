/**
 * Backfill Business pack+ship expenses for uploaded Galaxus DELRs.
 *
 *   npx tsx scripts/sync-galaxus-delr-fulfillment-expenses.ts
 *   npx tsx scripts/sync-galaxus-delr-fulfillment-expenses.ts --since 2026-01-01
 */
import "dotenv/config";
import { syncGalaxusDelrFulfillmentExpensesForUploaded } from "@/galaxus/warehouse/delrFulfillmentExpenses";

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

async function main() {
  const sinceRaw = argValue("--since");
  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (sinceRaw && Number.isNaN(since?.getTime())) {
    throw new Error(`Invalid --since: ${sinceRaw}`);
  }
  const result = await syncGalaxusDelrFulfillmentExpensesForUploaded({ since });
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
