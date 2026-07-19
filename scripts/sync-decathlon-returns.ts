#!/usr/bin/env npx tsx
/**
 * Manual Decathlon marketplace return sync.
 *
 * Usage:
 *   npx tsx scripts/sync-decathlon-returns.ts
 */
import { syncMarketplaceReturns } from "../decathlon/returns/receipt/sync";

async function main() {
  const result = await syncMarketplaceReturns();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
