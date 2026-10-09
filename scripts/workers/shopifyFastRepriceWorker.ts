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
 */
import { spawn } from "node:child_process";

const SHARDS = Math.max(1, Number(process.env.SHOPIFY_FAST_REPRICE_SHARDS ?? 4));
const PAUSE_MS = Math.max(0, Number(process.env.SHOPIFY_FAST_REPRICE_PAUSE_MS ?? 30 * 60 * 1000));
const SKIP_FRESH_HOURS = Math.max(0, Number(process.env.SHOPIFY_FAST_REPRICE_SKIP_FRESH_HOURS ?? 6));
const INITIAL_DELAY_MS = Math.max(0, Number(process.env.SHOPIFY_FAST_REPRICE_INITIAL_DELAY_MS ?? 60_000));
/** Failed pass (e.g. DB statement timeout on the row load) retries soon, not after PAUSE_MS. */
const FAILURE_RETRY_MS = Math.max(0, Number(process.env.SHOPIFY_FAST_REPRICE_FAILURE_RETRY_MS ?? 60_000));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runPass(shard: number): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      [
        "tsx",
        "scripts/reprice-shopify-fast.ts",
        "--apply",
        `--shards=${SHARDS}`,
        `--shard=${shard}`,
        "--limit=5000000",
        `--skip-fresh-hours=${SKIP_FRESH_HOURS}`,
        "--progress-every=1000",
      ],
      { stdio: ["ignore", "pipe", "pipe"], env: process.env }
    );
    const prefix = `[WORKER][SHOPIFY_FAST_REPRICE][s${shard}]`;
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
