import { enqueueOpsBackgroundJob } from "@/galaxus/ops/enqueueOpsBackgroundJob";
import { OPS_STX_HOT_REFRESH_JOB } from "@/galaxus/ops/opsBackgroundJobs";

/** Queue KickDB refresh for recently sold Galaxus STX products (ops-background). */
export async function startStxHotRefreshAsync(): Promise<{
  ok: boolean;
  accepted?: boolean;
  error?: string;
  status?: number;
}> {
  return enqueueOpsBackgroundJob({
    jobType: OPS_STX_HOT_REFRESH_JOB,
    groupKey: OPS_STX_HOT_REFRESH_JOB,
  });
}
