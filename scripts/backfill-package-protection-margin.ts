#!/usr/bin/env npx tsx
/**
 * Backfill package-protection Shopify lines into OrderMatch (100% margin, cost 0).
 *
 * Usage:
 *   npx tsx scripts/backfill-package-protection-margin.ts           # since year start
 *   npx tsx scripts/backfill-package-protection-margin.ts --days=90
 */
import "dotenv/config";

import { runShopifyOrdersSync } from "@/shopify/orders/sync";

function intFlag(name: string): number | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return undefined;
  const n = Number(hit.slice(prefix.length));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

async function main(): Promise<void> {
  const days = intFlag("days");
  const startDate = days
    ? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    : undefined;

  console.log(
    JSON.stringify({
      event: "backfill_package_protection.start",
      days: days ?? null,
      startDate: startDate?.toISOString() ?? "year-start",
    })
  );

  const result = await runShopifyOrdersSync({ startDate, pageSize: 60 });
  console.log(JSON.stringify({ event: "backfill_package_protection.done", ...result }));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
