import os from "os";
import { resolveAppOriginForPartnerJobs } from "@/app/lib/partnerJobOrigin";
import { rebuildFeedSnapshotFromExports } from "@/galaxus/exports/feedSnapshot";
import { resolveImageSyncSupplierKeys, runImageSync } from "@/galaxus/jobs/imageSync";
import { claimJob, completeJob, failJob } from "@/galaxus/jobs/queue";
import { runOpsJob } from "@/galaxus/ops/jobRunner";
import {
  OPS_IMAGE_SYNC_JOB,
  OPS_SNAPSHOT_REBUILD_JOB,
} from "@/galaxus/ops/opsBackgroundJobs";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const workerId = process.env.WORKER_ID || `${os.hostname()}-${process.pid}`;
  const pollMs = Math.max(Number(process.env.WORKER_POLL_MS ?? "3000"), 500);
  const jobTypes = [OPS_IMAGE_SYNC_JOB, OPS_SNAPSHOT_REBUILD_JOB];
  const defaultOrigin =
    resolveAppOriginForPartnerJobs(process.env.GALAXUS_FEED_WORKER_ORIGIN ?? null) ??
    "http://127.0.0.1:3000";

  console.info(`[ops-background-worker] start ${workerId} poll=${pollMs}ms`);

  for (;;) {
    let claimed = false;
    for (const jobType of jobTypes) {
      const job = await claimJob(jobType, workerId, { groupLimit: 1 });
      if (!job) continue;
      claimed = true;
      console.info("[ops-background-worker] claimed", { jobType, jobId: job.id });
      try {
        const payload = (job.payloadJson ?? {}) as Record<string, unknown>;
        const origin =
          typeof payload.origin === "string" && payload.origin.trim()
            ? payload.origin.trim()
            : defaultOrigin;
        if (jobType === OPS_IMAGE_SYNC_JOB) {
          await runOpsJob("image-sync", () =>
            runImageSync({
              full: true,
              limit: 2000,
              concurrency: 8,
              supplierKeys: resolveImageSyncSupplierKeys(),
            })
          );
        } else {
          await runOpsJob("feed-snapshot-rebuild", () => rebuildFeedSnapshotFromExports(origin));
        }
        await completeJob(job.id, { ok: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[ops-background-worker] failed", { jobType, message });
        await failJob(job.id, message);
      }
    }
    if (!claimed) await sleep(pollMs);
  }
}

run().catch((err) => {
  console.error("[ops-background-worker] fatal", err);
  process.exit(1);
});
