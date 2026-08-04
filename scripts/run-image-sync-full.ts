#!/usr/bin/env npx tsx
/**
 * Galaxus image sync (full) — VPS cron entrypoint (no after() on web).
 */
import { countImageSyncBacklog, resolveImageSyncSupplierKeys, runImageSync } from "@/galaxus/jobs/imageSync";
import { runOpsJob } from "@/galaxus/ops/jobRunner";

async function main() {
  const supplierKeys = resolveImageSyncSupplierKeys();
  const wallStarted = Date.now();
  console.info("[image-sync][full] start", { at: new Date().toISOString(), supplierKeys });

  const initialBacklog = await countImageSyncBacklog({ supplierKeys });
  console.info("[image-sync][full] initial backlog", initialBacklog);

  const res = await runOpsJob("image-sync", () =>
    runImageSync({
      full: true,
      limit: 2000,
      concurrency: 8,
      supplierKeys,
    })
  );

  const remaining = await countImageSyncBacklog({ supplierKeys });
  console.info("[image-sync][full] done", {
    ok: res.success,
    result: res.result,
    error: res.error,
    remaining,
    wallMs: Date.now() - wallStarted,
  });

  if (!res.success) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[image-sync][full] fatal", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
