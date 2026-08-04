import { prisma } from "@/app/lib/prisma";
import { resolveImageSyncSupplierKeys, runImageSync } from "@/galaxus/jobs/imageSync";
import { enqueueOpsBackgroundJob } from "@/galaxus/ops/enqueueOpsBackgroundJob";
import { runOpsJob } from "./jobRunner";
import { OPS_IMAGE_SYNC_JOB } from "@/galaxus/ops/opsBackgroundJobs";

const JOB_NAME = "ops-image-sync";

export async function getLatestImageSyncJobRun() {
  return (prisma as any).galaxusJobRun.findFirst({
    where: { jobName: JOB_NAME },
    orderBy: { startedAt: "desc" },
  });
}

/** Stale threshold: crash/restart can leave finishedAt == startedAt forever. Must exceed nightly full sync (~83m observed). */
const IMAGE_SYNC_STALE_MS = 4 * 60 * 60 * 1000;

type ImageSyncRunRow = {
  startedAt: Date | string;
  finishedAt: Date | string;
  success?: boolean;
  errorMessage?: string | null;
  resultJson?: unknown;
};

/** Job run rows are created with finishedAt = startedAt until the handler completes. */
export function isImageSyncJobRunning(run: ImageSyncRunRow | null | undefined): boolean {
  if (!run?.startedAt || !run?.finishedAt) return false;
  const startedMs = new Date(run.startedAt).getTime();
  const finishedMs = new Date(run.finishedAt).getTime();
  if (finishedMs > startedMs) return false;
  if (
    run.success === false &&
    !run.errorMessage &&
    run.resultJson == null &&
    Date.now() - startedMs > 10 * 60 * 1000
  ) {
    return false;
  }
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

  return enqueueOpsBackgroundJob({ jobType: OPS_IMAGE_SYNC_JOB, groupKey: OPS_IMAGE_SYNC_JOB });
}

/** Direct run for cron tsx scripts — not via web/queue. */
export async function runImageSyncFullDirect(): Promise<void> {
  await runOpsJob("image-sync", () =>
    runImageSync({
      full: true,
      limit: 2000,
      concurrency: 8,
      supplierKeys: resolveImageSyncSupplierKeys(),
    })
  );
}
