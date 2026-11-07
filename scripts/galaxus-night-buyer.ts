/**
 * Overnight Galaxus → StockX buyer. Kill switch: delete .data/night-buyer.on
 * Halt (needs a human): .data/night-buyer.halt exists. Report: .data/night-buyer-report.md
 *
 *   NIGHT_BUYER_SINCE=2026-10-22 NIGHT_BUYER_SKIP_ORDERS=208510767 npx tsx scripts/galaxus-night-buyer.ts
 *   NIGHT_BUYER_DRY=1  → lane check only, no Place Order
 *
 * Started by docker-entrypoint.sh when .data/night-buyer.on exists, restarted on crash.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import { prisma } from "@/app/lib/prisma";
import {
  HALT_FILE,
  ON_FILE,
  buildNightQueue,
  closeSession,
  loadState,
  pairKey,
  processPair,
  reconcileInflight,
  saveState,
  stateBlocks,
  writeReport,
} from "@/lib/stockxAutoCheckout/galaxusNightBuyer";

const exists = (f: string) => fs.stat(f).then(() => true).catch(() => false);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const since = new Date(`${process.env.NIGHT_BUYER_SINCE || "2026-10-22"}T00:00:00+02:00`);
  const skipOrders = new Set(
    (process.env.NIGHT_BUYER_SKIP_ORDERS || "208510767")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  console.warn(`[NIGHT-BUYER] start since=${since.toISOString()} skip=${[...skipOrders].join(",")}`);
  await reconcileInflight();

  while (await exists(ON_FILE)) {
    if (await exists(HALT_FILE)) {
      console.error(`[NIGHT-BUYER] halted — remove ${HALT_FILE} after fixing`);
      await sleep(30_000);
      continue;
    }
    const state = await loadState();
    const queue = await buildNightQueue({ since, skipOrders });
    const todo = queue.filter((p) => !stateBlocks(state[pairKey(p)], Date.now()));
    console.warn(`[NIGHT-BUYER] queue=${queue.length} todo=${todo.length} (oldest first)`);
    if (!todo.length) {
      await writeReport(state);
      await sleep(120_000);
      continue;
    }
    for (const pair of todo) {
      if (!(await exists(ON_FILE)) || (await exists(HALT_FILE))) break;
      await processPair(pair, state);
      await saveState(state);
      await writeReport(state);
      await sleep(2_500);
    }
  }
  console.warn("[NIGHT-BUYER] stopped (night-buyer.on removed)");
  await closeSession();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("[NIGHT-BUYER] crash", e);
  await closeSession().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
