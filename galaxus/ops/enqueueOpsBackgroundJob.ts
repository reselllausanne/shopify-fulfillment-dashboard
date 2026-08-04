import { prisma } from "@/app/lib/prisma";
import { enqueueJob } from "@/galaxus/jobs/queue";
import {
  OPS_IMAGE_SYNC_JOB,
  OPS_SNAPSHOT_REBUILD_JOB,
} from "@/galaxus/ops/opsBackgroundJobs";

export async function countQueuedOpsJobs(jobType: string): Promise<number> {
  return (prisma as any).galaxusJobQueue.count({
    where: { jobType, status: { in: ["PENDING", "RUNNING"] } },
  });
}

export async function enqueueOpsBackgroundJob(params: {
  jobType: typeof OPS_IMAGE_SYNC_JOB | typeof OPS_SNAPSHOT_REBUILD_JOB;
  origin?: string | null;
  groupKey?: string;
}): Promise<{ ok: boolean; accepted?: boolean; error?: string; status?: number }> {
  const pending = await countQueuedOpsJobs(params.jobType);
  if (pending > 0) {
    return { ok: false, error: `${params.jobType} already queued or running`, status: 409 };
  }

  await enqueueJob(
    params.jobType,
    { origin: params.origin ?? null },
    { groupKey: params.groupKey ?? params.jobType, maxAttempts: 1 }
  );

  return { ok: true, accepted: true };
}
