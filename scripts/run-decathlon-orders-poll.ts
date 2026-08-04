#!/usr/bin/env npx tsx
/**
 * Decathlon Mirakl order poll — VPS cron entrypoint (no HTTP curl to web).
 */
import { runDecathlonOrdersPoll } from "@/decathlon/orders/pollOrders";

async function main() {
  const wallStarted = Date.now();
  console.info("[DECATHLON][ORDERS][POLL] start", { at: new Date().toISOString() });

  const result = await runDecathlonOrdersPoll();

  console.info("[DECATHLON][ORDERS][POLL] done", {
    ...result,
    wallMs: Date.now() - wallStarted,
  });

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[DECATHLON][ORDERS][POLL] fatal", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
