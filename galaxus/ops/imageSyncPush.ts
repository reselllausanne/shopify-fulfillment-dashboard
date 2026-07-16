import { prisma } from "@/app/lib/prisma";
import { runImageSync } from "@/galaxus/jobs/imageSync";
import { runOpsJob } from "./jobRunner";

const JOB_NAME = "ops-image-sync";

export async function getLatestImageSyncJobRun() {
  return (prisma as any).galaxusJobRun.findFirst({
    where: { jobName: JOB_NAME },
    orderBy: { startedAt: "desc" },
  });
}

/** Stale threshold: crash/restart can leave finishedAt == startedAt forever. */
const IMAGE_SYNC_STALE_MS = 2 * 60 * 60 * 1000;

/** Job run rows are created with finishedAt = startedAt until the handler completes. */
export function isImageSyncJobRunning(
  run: { startedAt: Date | string; finishedAt: Date | string } | null | undefined
): boolean {
  if (!run?.startedAt || !run?.finishedAt) return false;
  const startedMs = new Date(run.startedAt).getTime();
  const finishedMs = new Date(run.finishedAt).getTime();
  if (finishedMs > startedMs) return false;
  // Still "open" but too old → treat as not running so cron/UI can recover.
  if (Date.now() - startedMs > IMAGE_SYNC_STALE_MS) return false;
  return true;
}

export async function startImageSyncFullAsync(): Promise<{
  ok: boolean;
  accepted?: boolean;
  error?: string;
  status?: number;
}> {
  const latest = await getLatestImageSyncJobRun();
  if (isImageSyncJobRunning(latest)) {
    return { ok: false, error: "Image sync already running", status: 409 };
  }

  void runOpsJob("image-sync", () =>
    runImageSync({
      full: true,
      limit: 2000,
      concurrency: 8,
      supplierKeys: ["stx", "the"],
    })
  ).catch((err) => {
    console.error("[GALAXUS][IMAGE-SYNC][ASYNC] Background sync failed:", err);
  });

  return { ok: true, accepted: true };
}
