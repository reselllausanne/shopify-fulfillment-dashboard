#!/usr/bin/env npx tsx
/**
 * Shopify liquidation convergence — VPS cron entrypoint.
 * Runs convergeAll off the Next.js HTTP server (no curl / maxDuration cap).
 *
 * Usage:
 *   npx tsx scripts/run-convergence.ts
 *   docker compose exec -T web npx tsx scripts/run-convergence.ts
 */
import { convergeAll } from "../shopify/inventory/convergence";

async function main() {
  const wallStarted = Date.now();
  console.info("[CONVERGENCE] start", { at: new Date().toISOString() });

  const res = await convergeAll({});

  const wallMs = Date.now() - wallStarted;
  console.info(
    "[CONVERGENCE] done",
    JSON.stringify({
      ok: res.ok,
      scanned: res.scanned,
      changed: res.changed,
      errors: res.errors,
      ms: res.ms,
      wallMs,
      sampleCount: res.sample.length,
    })
  );

  if (!res.ok || res.errors > 0) {
    process.exitCode = res.errors > 0 ? 1 : 0;
  }
}

main().catch((error) => {
  console.error("[CONVERGENCE] fatal", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
