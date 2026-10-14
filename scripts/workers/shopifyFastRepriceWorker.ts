#!/usr/bin/env npx tsx
/**
 * Continuous product-batched Shopify reprice.
 *
 * Loops `scripts/reprice-shopify-fast.ts --apply`. Budget: the whole token shares
 * one 2000-point bucket refilled at 100 pts/s (web, other workers included), so
 * every loop here only reads Shopify for real diffs:
 *   - main loop: DB diff (formula price vs `ChannelListingState.lastPushedPrice`),
 *     reads + pushes only the products with a changed size;
 *   - drift loop: same, restricted to sizes whose StockX buy changed recently;
 *   - verify loop: one bulk export of every variant compared locally — catches
 *     prices/express overwritten outside this worker without per-product reads;
 *   - stock loop: nightly Website-stock reconcile (bulk export + batched
 *     `inventorySetQuantities`).
 * All child processes share the bucket estimate through a file in /tmp
 * (`lib/shopifyThrottle.ts`) and keep SHOPIFY_API_RESERVE_POINTS free.
 *
 * Env:
 *   SHOPIFY_FAST_REPRICE_SHARDS            default 1 (parallel main loops; >1 only splits DB load)
 *   SHOPIFY_FAST_REPRICE_PAUSE_MS          default 1800000 (rest between main passes per shard)
 *   SHOPIFY_FAST_REPRICE_SKIP_FRESH_HOURS  default 6 (skip variants pushed within N h; 0 = all)
 *   SHOPIFY_FAST_REPRICE_INITIAL_DELAY_MS  default 60000
 *   SHOPIFY_FAST_REPRICE_FAILURE_RETRY_MS  default 60000 (retry delay after a failed pass)
 *   SHOPIFY_FAST_REPRICE_DRIFT_PAUSE_MS    default 900000 (drift loop pause; 0 disables)
 *   SHOPIFY_FAST_REPRICE_DRIFT_MAX_PRODUCTS default 500 (products per drift pass)
 *   SHOPIFY_FAST_REPRICE_VERIFY_PAUSE_MS   default 21600000 (bulk verification pause; 0 disables)
 *   SHOPIFY_STX_STOCK_RECONCILE_AT         default "03:00" (Europe/Zurich daily run time;
 *                                          empty = use SHOPIFY_STX_STOCK_RECONCILE_PAUSE_MS loop)
 *   SHOPIFY_STX_STOCK_RECONCILE_PAUSE_MS   default 21600000 (loop pause when _AT is empty;
 *                                          0 disables the stock loop entirely)
 */
import { spawn } from "node:child_process";

import { msUntilNextZurichTime } from "../../lib/zurichSchedule";

const SHARDS = Math.max(1, Number(process.env.SHOPIFY_FAST_REPRICE_SHARDS ?? 1));
const PAUSE_MS = Math.max(0, Number(process.env.SHOPIFY_FAST_REPRICE_PAUSE_MS ?? 30 * 60 * 1000));
const SKIP_FRESH_HOURS = Math.max(0, Number(process.env.SHOPIFY_FAST_REPRICE_SKIP_FRESH_HOURS ?? 6));
const INITIAL_DELAY_MS = Math.max(0, Number(process.env.SHOPIFY_FAST_REPRICE_INITIAL_DELAY_MS ?? 60_000));
/** Failed pass (e.g. DB statement timeout on the row load) retries soon, not after PAUSE_MS. */
const FAILURE_RETRY_MS = Math.max(0, Number(process.env.SHOPIFY_FAST_REPRICE_FAILURE_RETRY_MS ?? 60_000));
const DRIFT_PAUSE_MS = Math.max(0, Number(process.env.SHOPIFY_FAST_REPRICE_DRIFT_PAUSE_MS ?? 15 * 60 * 1000));
const DRIFT_MAX_PRODUCTS = Math.max(1, Number(process.env.SHOPIFY_FAST_REPRICE_DRIFT_MAX_PRODUCTS ?? 500));
const VERIFY_PAUSE_MS = Math.max(0, Number(process.env.SHOPIFY_FAST_REPRICE_VERIFY_PAUSE_MS ?? 6 * 60 * 60 * 1000));
const STOCK_RECONCILE_AT = (process.env.SHOPIFY_STX_STOCK_RECONCILE_AT ?? "03:00").trim();
const STOCK_RECONCILE_PAUSE_MS = Math.max(
  0,
  Number(process.env.SHOPIFY_STX_STOCK_RECONCILE_PAUSE_MS ?? 6 * 60 * 60 * 1000)
);
const SCHEDULE_TZ = "Europe/Zurich";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runPass(shard: number): Promise<number> {
  return runReprice(`s${shard}`, [
    `--shards=${SHARDS}`,
    `--shard=${shard}`,
    "--limit=5000000",
    `--skip-fresh-hours=${SKIP_FRESH_HOURS}`,
    "--progress-every=1000",
  ]);
}

function runDriftPass(): Promise<number> {
  return runReprice("drift", [
    "--only-drifted",
    "--skip-fresh-hours=0",
    "--limit=5000000",
    `--max-products=${DRIFT_MAX_PRODUCTS}`,
    "--progress-every=500",
  ]);
}

function runVerifyPass(): Promise<number> {
  return runReprice("verify", ["--verify-bulk", "--limit=5000000", "--progress-every=5000"]);
}

function runReprice(tag: string, args: string[]): Promise<number> {
  return runScript(tag, "scripts/reprice-shopify-fast.ts", args);
}

function runScript(tag: string, script: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", script, "--apply", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    const prefix = `[WORKER][SHOPIFY_FAST_REPRICE][${tag}]`;
    const pipe = (stream: NodeJS.ReadableStream, log: (line: string) => void) => {
      let buf = "";
      stream.on("data", (chunk) => {
        buf += String(chunk);
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) log(`${prefix} ${line}`);
      });
    };
    pipe(child.stdout, (l) => console.info(l));
    pipe(child.stderr, (l) => console.error(l));
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      console.error(`${prefix} spawn failed`, err.message);
      resolve(1);
    });
  });
}

async function loop(tag: string, initialDelayMs: number, pauseMs: number, run: () => Promise<number>): Promise<never> {
  await sleep(initialDelayMs);
  while (true) {
    const startedAt = Date.now();
    const code = await run();
    console.info(`[WORKER][SHOPIFY_FAST_REPRICE][${tag}] pass done`, {
      exitCode: code,
      durationMs: Date.now() - startedAt,
    });
    await sleep(code === 0 ? pauseMs : FAILURE_RETRY_MS);
  }
}

async function stockReconcileLoop(): Promise<never> {
  const runStock = () => runScript("stock", "scripts/reconcile-shopify-stx-stock.ts", ["--progress-every=500"]);
  if (!STOCK_RECONCILE_AT) {
    await sleep(INITIAL_DELAY_MS * 2);
  }
  while (true) {
    if (STOCK_RECONCILE_AT) {
      const waitMs = msUntilNextZurichTime(STOCK_RECONCILE_AT);
      console.info(`[WORKER][SHOPIFY_FAST_REPRICE][stock] next run at ${STOCK_RECONCILE_AT} ${SCHEDULE_TZ}`, {
        inMinutes: Math.round(waitMs / 60_000),
      });
      await sleep(waitMs);
    }
    const startedAt = Date.now();
    const code = await runStock();
    console.info("[WORKER][SHOPIFY_FAST_REPRICE][stock] pass done", {
      exitCode: code,
      durationMs: Date.now() - startedAt,
    });
    if (!STOCK_RECONCILE_AT) await sleep(code === 0 ? STOCK_RECONCILE_PAUSE_MS : FAILURE_RETRY_MS * 10);
    else await sleep(60_000);
  }
}

console.info("[WORKER][SHOPIFY_FAST_REPRICE] starting", {
  shards: SHARDS,
  pauseMs: PAUSE_MS,
  skipFreshHours: SKIP_FRESH_HOURS,
  driftPauseMs: DRIFT_PAUSE_MS,
  driftMaxProducts: DRIFT_MAX_PRODUCTS,
  verifyPauseMs: VERIFY_PAUSE_MS,
  stockAt: STOCK_RECONCILE_AT || null,
  stockPauseMs: STOCK_RECONCILE_AT ? null : STOCK_RECONCILE_PAUSE_MS,
  reservePoints: process.env.SHOPIFY_API_RESERVE_POINTS ?? null,
});
for (let s = 0; s < SHARDS; s += 1) {
  void loop(`s${s}`, INITIAL_DELAY_MS + s * 15_000, PAUSE_MS, () => runPass(s));
}
if (DRIFT_PAUSE_MS > 0) void loop("drift", INITIAL_DELAY_MS, DRIFT_PAUSE_MS, runDriftPass);
if (VERIFY_PAUSE_MS > 0) void loop("verify", INITIAL_DELAY_MS + 10 * 60_000, VERIFY_PAUSE_MS, runVerifyPass);
if (STOCK_RECONCILE_PAUSE_MS > 0) void stockReconcileLoop();
