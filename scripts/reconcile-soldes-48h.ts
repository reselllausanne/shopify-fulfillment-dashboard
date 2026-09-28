#!/usr/bin/env npx tsx
/**
 * Clear stale product `custom.soldes_48h` (the theme SALES badge) for pairs that
 * are no longer on soldes — i.e. no variant has `custom.delivery_48h=true`.
 *
 * soldes_48h is a legacy flag the theme still reads; the live soldes state is
 * variant delivery_48h (stock-linked via convergence). This links the SALES
 * badge back to our local stock.
 *
 * Usage:
 *   npx tsx scripts/reconcile-soldes-48h.ts            # dry-run
 *   npx tsx scripts/reconcile-soldes-48h.ts --write
 */
import "dotenv/config";
import { reconcileProductSoldes48hMetafields } from "@/shopify/inventory/productSoldes48hMetafield";

const WRITE = process.argv.includes("--write");

async function main() {
  const res = await reconcileProductSoldes48hMetafields({ dryRun: !WRITE });
  console.log(
    JSON.stringify({ write: WRITE, ...res }, null, 2)
  );
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
