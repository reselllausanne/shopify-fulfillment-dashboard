#!/usr/bin/env npx tsx
/**
 * Continuous product-batched Shopify reprice.
 *
 * The per-GTIN worker (shopifyStxPriceSyncWorker) refreshes ~1k variants/hour,
 * so a formula change takes ~20 days to reach ~490k live variants. This worker
 * loops `scripts/reprice-shopify-fast.ts --apply` per shard instead: one
 * Shopify query + one bulk mutation per product, and only variants whose live
 * price differs from the locked formula are written. Each shard loops on its
 * own so a slow shard never blocks the others.
 *
 * Env:
 *   SHOPIFY_FAST_REPRICE_SHARDS            default 4 (parallel shard loops)
 *   SHOPIFY_FAST_REPRICE_PAUSE_MS          default 1800000 (rest between passes per shard)
 *   SHOPIFY_FAST_REPRICE_SKIP_FRESH_HOURS  default 6 (skip variants pushed within N h; 0 = all)
 *   SHOPIFY_FAST_REPRICE_INITIAL_DELAY_MS  default 60000
 *   SHOPIFY_FAST_REPRICE_FAILURE_RETRY_MS  default 60000 (retry delay after a failed pass)
 *   SHOPIFY_FAST_REPRICE_DRIFT_PAUSE_MS    default 300000 (drift loop: sizes whose StockX buy
 *                                          changed since the last Shopify write; 0 disables)
 *   SHOPIFY_FAST_REPRICE_DRIFT_MAX_PRODUCTS default 1500 (products per drift pass)
 *   SHOPIFY_STX_STOCK_RECONCILE_PAUSE_MS   default 21600000 (rest between Website-stock
 *                                          reconcile passes, `scripts/reconcile-shopify-stx-stock.ts`;
 *                                          0 disables)
 *
 * A full pass takes ~7.5h; without the drift loop a StockX price rise stays
 * under cost on Shopify until the shard comes back around.
 */
import { spawn } from "node:child_process";

const SHARDS = Math.max(1, Number(process.env.SHOPIFY_FAST_REPRICE_SHARDS ?? 4));
const PAUSE_MS = Math.max(0, Number(process.env.SHOPIFY_FAST_REPRICE_PAUSE_MS ?? 30 * 60 * 1000));
const SKIP_FRESH_HOURS = Math.max(0, Number(process.env.SHOPIFY_FAST_REPRICE_SKIP_FRESH_HOURS ?? 6));
const INITIAL_DELAY_MS = Math.max(0, Number(process.env.SHOPIFY_FAST_REPRICE_INITIAL_DELAY_MS ?? 60_000));
/** Failed pass (e.g. DB statement timeout on the row load) retries soon, not after PAUSE_MS. */
const FAILURE_RETRY_MS = Math.max(0, Number(process.env.SHOPIFY_FAST_REPRICE_FAILURE_RETRY_MS ?? 60_000));
const DRIFT_PAUSE_MS = Math.max(0, Number(process.env.SHOPIFY_FAST_REPRICE_DRIFT_PAUSE_MS ?? 5 * 60 * 1000));
const DRIFT_MAX_PRODUCTS = Math.max(1, Number(process.env.SHOPIFY_FAST_REPRICE_DRIFT_MAX_PRODUCTS ?? 1500));
const STOCK_RECONCILE_PAUSE_MS = Math.max(
  0,
  Number(process.env.SHOPIFY_STX_STOCK_RECONCILE_PAUSE_MS ?? 6 * 60 * 60 * 1000)
);

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

async function shardLoop(shard: number): Promise<never> {
  await sleep(INITIAL_DELAY_MS + shard * 15_000);
  while (true) {
    const startedAt = Date.now();
    const code = await runPass(shard);
    console.info(`[WORKER][SHOPIFY_FAST_REPRICE][s${shard}] pass done`, {
      exitCode: code,
      durationMs: Date.now() - startedAt,
    });
    await sleep(code === 0 ? PAUSE_MS : FAILURE_RETRY_MS);
  }
}

console.info("[WORKER][SHOPIFY_FAST_REPRICE] starting", {
  shards: SHARDS,
  pauseMs: PAUSE_MS,
  skipFreshHours: SKIP_FRESH_HOURS,
});
for (let s = 0; s < SHARDS; s += 1) void shardLoop(s);

async function driftLoop(): Promise<never> {
  await sleep(INITIAL_DELAY_MS);
  while (true) {
    const startedAt = Date.now();
    const code = await runDriftPass();
    console.info("[WORKER][SHOPIFY_FAST_REPRICE][drift] pass done", {
      exitCode: code,
      durationMs: Date.now() - startedAt,
    });
    await sleep(code === 0 ? DRIFT_PAUSE_MS : FAILURE_RETRY_MS);
  }
}
if (DRIFT_PAUSE_MS > 0) void driftLoop();

async function stockReconcileLoop(): Promise<never> {
  await sleep(INITIAL_DELAY_MS * 2);
  while (true) {
    const startedAt = Date.now();
    const code = await runScript("stock", "scripts/reconcile-shopify-stx-stock.ts", ["--progress-every=500"]);
    console.info("[WORKER][SHOPIFY_FAST_REPRICE][stock] pass done", {
      exitCode: code,
      durationMs: Date.now() - startedAt,
    });
    await sleep(code === 0 ? STOCK_RECONCILE_PAUSE_MS : FAILURE_RETRY_MS * 10);
  }
}
if (STOCK_RECONCILE_PAUSE_MS > 0) void stockReconcileLoop();
