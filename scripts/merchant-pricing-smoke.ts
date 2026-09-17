#!/usr/bin/env npx tsx
/**
 * Read-only Merchant Center pricing smoke test entrypoint.
 *
 * Usage:
 *   npm run merchant:pricing-smoke -- --account=669442699 --country=CH --limit=50
 */
import "dotenv/config";

import {
  EXIT_OK,
  runMerchantPricingSmokeCli,
} from "../adsanalytics/commands/merchantPricingSmoke";

async function main(): Promise<void> {
  const code = await runMerchantPricingSmokeCli(process.argv.slice(2));
  process.exit(code === undefined ? EXIT_OK : code);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
