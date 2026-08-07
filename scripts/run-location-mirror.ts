#!/usr/bin/env npx tsx
/**
 * Shopify → DB location-stock mirror — VPS cron entrypoint (no HTTP curl to web).
 *
 * Recovery runs in the same pass: a restock is only sellable once the GTIN has a
 * catalog row + mapping, so mirroring without recovering would leave new physical
 * stock invisible to marketplaces until the next slow job.
 */
import { syncAllLocationsBulk } from "@/shopify/inventory/locationMirror";
import { recoverPhysicalStockForGalaxus } from "@/galaxus/jobs/physicalStockRecovery";

async function main() {
  const wallStarted = Date.now();
  console.info("[LOCATION-MIRROR] start", { at: new Date().toISOString() });

  const result = await syncAllLocationsBulk();

  console.info("[LOCATION-MIRROR] mirror done", {
    ...result,
    wallMs: Date.now() - wallStarted,
  });

  try {
    const recovery = await recoverPhysicalStockForGalaxus({
      dryRun: false,
      triggerFeedPush: true,
    });
    console.info("[LOCATION-MIRROR] recovery done", recovery);
  } catch (error) {
    console.error(
      "[LOCATION-MIRROR] recovery failed",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  }

  console.info("[LOCATION-MIRROR] done", { wallMs: Date.now() - wallStarted });

  if (result && typeof result === "object" && "ok" in result && result.ok === false) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[LOCATION-MIRROR] fatal", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
