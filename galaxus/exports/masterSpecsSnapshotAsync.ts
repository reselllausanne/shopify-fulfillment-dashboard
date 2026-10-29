import { prisma } from "@/app/lib/prisma";
import { enqueueOpsBackgroundJob } from "@/galaxus/ops/enqueueOpsBackgroundJob";
import { OPS_MASTER_SPECS_SNAPSHOT_REBUILD_JOB } from "@/galaxus/ops/opsBackgroundJobs";

const REBUILD_JOB_NAME = "feed-master-specs-snapshot-rebuild";
const STALE_MS = 4 * 60 * 60 * 1000; // Rebuild ~40 min today; cap wait at 4h to reap zombies.

type JobRun = {
  startedAt: Date | string;
  finishedAt: Date | string;
  success?: boolean;
  errorMessage?: string | null;
  resultJson?: unknown;
};

export async function getLatestMasterSpecsRebuildJobRun() {
  return (prisma as any).galaxusJobRun.findFirst({
    where: { jobName: REBUILD_JOB_NAME },
    orderBy: { startedAt: "desc" },
  });
}

/** Same shape as isFeedSnapshotRebuildRunning so cron/ops UI logic stays symmetric. */
export function isMasterSpecsSnapshotRebuildRunning(
  run: JobRun | null | undefined
): boolean {
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
  if (Date.now() - startedMs > STALE_MS) return false;
  return true;
}

/**
 * Enqueue the master/specs snapshot rebuild onto the ops-background worker.
 * Never runs on the web container (too much heap).
 */
export async function startMasterSpecsSnapshotRebuildAsync(): Promise<{
  ok: boolean;
  accepted?: boolean;
  error?: string;
  status?: number;
}> {
  const latest = await getLatestMasterSpecsRebuildJobRun();
  if (isMasterSpecsSnapshotRebuildRunning(latest)) {
    return {
      ok: false,
      error: "Master/specs snapshot rebuild already running",
      status: 409,
    };
  }
  return enqueueOpsBackgroundJob({
    jobType: OPS_MASTER_SPECS_SNAPSHOT_REBUILD_JOB,
    groupKey: OPS_MASTER_SPECS_SNAPSHOT_REBUILD_JOB,
  });
}

export const MASTER_SPECS_REBUILD_JOB_NAME = REBUILD_JOB_NAME;
