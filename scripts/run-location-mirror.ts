#!/usr/bin/env npx tsx
/**
 * Shopify → DB location-stock mirror — VPS cron entrypoint (no HTTP curl to web).
 */
import { syncAllLocationsBulk } from "@/shopify/inventory/locationMirror";

async function main() {
  const wallStarted = Date.now();
  console.info("[LOCATION-MIRROR] start", { at: new Date().toISOString() });

  const result = await syncAllLocationsBulk();

  console.info("[LOCATION-MIRROR] done", {
    ...result,
    wallMs: Date.now() - wallStarted,
  });

  if (result && typeof result === "object" && "ok" in result && result.ok === false) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[LOCATION-MIRROR] fatal", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
