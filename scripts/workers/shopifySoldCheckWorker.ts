#!/usr/bin/env npx tsx
/**
 * Phase 3 worker — Shopify sold-check.
 *
 * Runs runShopifySoldCheck on a fixed interval (default 2 days). Detects
 * restocked in-hand pairs sold on Shopify and delists them everywhere +
 * unlocks price + refreshes the product listing.
 *
 * Env:
 *   SHOPIFY_SOLD_CHECK_INTERVAL_MS  default 172800000 (2 days)
 *   SHOPIFY_SOLD_CHECK_INITIAL_DELAY_MS  default 60000
 *   SHOPIFY_RESTOCK_DRY_RUN=0  required for real writes
 */
import { runShopifySoldCheck } from "../../shopify/restock/soldCheckCron";

const INTERVAL_MS = Number(process.env.SHOPIFY_SOLD_CHECK_INTERVAL_MS ?? 2 * 24 * 60 * 60 * 1000);
const INITIAL_DELAY_MS = Number(process.env.SHOPIFY_SOLD_CHECK_INITIAL_DELAY_MS ?? 60_000);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOnce() {
  const startedAt = new Date().toISOString();
  try {
    const result = await runShopifySoldCheck({});
    console.info("[WORKER][SHOPIFY_SOLD_CHECK] run", {
      startedAt,
      ok: result.ok,
      dryRun: result.dryRun,
      checked: result.checked,
      soldCount: result.soldCount,
    });
    if (result.soldCount > 0) {
      console.info(
        "[WORKER][SHOPIFY_SOLD_CHECK] sold items",
        JSON.stringify(result.items.filter((i) => i.status.startsWith("sold")))
      );
    }
  } catch (error: any) {
    console.error("[WORKER][SHOPIFY_SOLD_CHECK] failed", error?.message ?? error);
  }
}

async function main() {
  console.info("[WORKER][SHOPIFY_SOLD_CHECK] starting", {
    intervalMs: INTERVAL_MS,
    initialDelayMs: INITIAL_DELAY_MS,
  });
  await sleep(INITIAL_DELAY_MS);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await runOnce();
    await sleep(INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error("[WORKER][SHOPIFY_SOLD_CHECK] fatal", error);
  process.exitCode = 1;
});
