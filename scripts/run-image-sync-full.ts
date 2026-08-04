#!/usr/bin/env npx tsx
/**
 * Galaxus image sync (full) — VPS cron entrypoint (no after() on web).
 */
import { countImageSyncBacklog, resolveImageSyncSupplierKeys } from "@/galaxus/jobs/imageSync";
import { runImageSyncFullDirect } from "@/galaxus/ops/imageSyncPush";

async function main() {
  const supplierKeys = resolveImageSyncSupplierKeys();
  const wallStarted = Date.now();
  console.info("[image-sync][full] start", { at: new Date().toISOString(), supplierKeys });

  const initialBacklog = await countImageSyncBacklog({ supplierKeys });
  console.info("[image-sync][full] initial backlog", initialBacklog);

  try {
    await runImageSyncFullDirect();
    const remaining = await countImageSyncBacklog({ supplierKeys });
    console.info("[image-sync][full] done", { remaining, wallMs: Date.now() - wallStarted });
  } catch (error) {
    console.error("[image-sync][full] failed", error);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[image-sync][full] fatal", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
