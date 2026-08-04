#!/usr/bin/env npx tsx
/**
 * Galaxus feed snapshot rebuild — VPS cron entrypoint (no after() on web).
 */
import { resolveAppOriginForPartnerJobs } from "@/app/lib/partnerJobOrigin";
import { rebuildFeedSnapshotFromExports } from "@/galaxus/exports/feedSnapshot";
import { runOpsJob } from "@/galaxus/ops/jobRunner";

async function main() {
  const wallStarted = Date.now();
  const origin = resolveAppOriginForPartnerJobs(null) ?? "http://127.0.0.1:3000";
  console.info("[SNAPSHOT-REBUILD] start", { at: new Date().toISOString(), origin });

  const res = await runOpsJob("feed-snapshot-rebuild", () => rebuildFeedSnapshotFromExports(origin));

  console.info("[SNAPSHOT-REBUILD] done", {
    ok: res.success,
    result: res.result,
    error: res.error,
    wallMs: Date.now() - wallStarted,
  });

  if (!res.success) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[SNAPSHOT-REBUILD] fatal", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
