import { enqueueOpsBackgroundJob } from "@/galaxus/ops/enqueueOpsBackgroundJob";
import { OPS_STX_REFRESH_JOB } from "@/galaxus/ops/opsBackgroundJobs";

/** Queue a STX price/stock refresh shard on ops-background (not web). */
export async function startStxRefreshAsync(options?: {
  mode?: "price" | "full";
}): Promise<{
  ok: boolean;
  accepted?: boolean;
  error?: string;
  status?: number;
}> {
  const mode = options?.mode === "full" ? "full" : "price";
  return enqueueOpsBackgroundJob({
    jobType: OPS_STX_REFRESH_JOB,
    groupKey: OPS_STX_REFRESH_JOB,
    payload: { stxRefreshMode: mode },
  });
}
