import { enqueueOpsBackgroundJob } from "@/galaxus/ops/enqueueOpsBackgroundJob";
import { OPS_GLD_REFRESH_JOB } from "@/galaxus/ops/opsBackgroundJobs";

/** Queue Golden price/stock refresh on ops-background worker (not web). */
export async function startGldRefreshAsync(): Promise<{
  ok: boolean;
  accepted?: boolean;
  error?: string;
  status?: number;
}> {
  return enqueueOpsBackgroundJob({
    jobType: OPS_GLD_REFRESH_JOB,
    groupKey: OPS_GLD_REFRESH_JOB,
  });
}
