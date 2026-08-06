/**
 * Backfill Business ship+fulfill expenses for Shopify fulfilled shoe orders.
 *
 *   npx tsx scripts/sync-shopify-fulfillment-expenses.ts
 *   npx tsx scripts/sync-shopify-fulfillment-expenses.ts --since 2026-06-01
 *   npm run shopify:fulfill-fees
 *
 * Default window: last 2 months (fulfillment record createdAt).
 */
import "dotenv/config";
import {
  defaultShopifyFulfillExpensesSince,
  syncShopifyFulfillmentExpenses,
} from "@/shopify/fulfillmentExpenses";

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

async function main() {
  const sinceRaw = argValue("--since");
  const since = sinceRaw ? new Date(sinceRaw) : defaultShopifyFulfillExpensesSince();
  if (Number.isNaN(since.getTime())) {
    throw new Error(`Invalid --since: ${sinceRaw}`);
  }
  const limitRaw = argValue("--limit");
  const limit = limitRaw != null ? Number(limitRaw) : undefined;
  const result = await syncShopifyFulfillmentExpenses({
    since,
    limit: Number.isFinite(limit) ? limit : undefined,
  });
  console.log(JSON.stringify({ since: since.toISOString(), ...result }, null, 2));
  if (result.errors.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
