#!/usr/bin/env npx tsx
/**
 * Clear stale product `custom.soldes_48h` (the theme SALES badge) when no
 * in-stock variant still has compare-at above price. Reprice leaves stock
 * in place and used to leave the badge on.
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
