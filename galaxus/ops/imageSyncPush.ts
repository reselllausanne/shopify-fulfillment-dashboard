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

/** Job run rows are created with finishedAt = startedAt until the handler completes. */
export function isImageSyncJobRunning(
  run: { startedAt: Date | string; finishedAt: Date | string } | null | undefined
): boolean {
  if (!run?.startedAt || !run?.finishedAt) return false;
  return new Date(run.finishedAt).getTime() <= new Date(run.startedAt).getTime();
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
