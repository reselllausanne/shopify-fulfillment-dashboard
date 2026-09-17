import { enqueueOpsBackgroundJob } from "@/galaxus/ops/enqueueOpsBackgroundJob";
import { OPS_STX_REFRESH_JOB } from "@/galaxus/ops/opsBackgroundJobs";

export type StxRefreshMode = "price" | "full";

/** Queue StockX/KickDB refresh on ops-background worker (multi-hour; never on web). */
export async function startStxRefreshAsync(params?: {
  mode?: StxRefreshMode;
  origin?: string | null;
}): Promise<{ ok: boolean; accepted?: boolean; error?: string; status?: number; mode?: StxRefreshMode }> {
  const mode: StxRefreshMode = params?.mode === "full" ? "full" : "price";
  const enqueued = await enqueueOpsBackgroundJob({
    jobType: OPS_STX_REFRESH_JOB,
    origin: params?.origin ?? null,
    groupKey: OPS_STX_REFRESH_JOB,
    payload: { mode },
    maxAttempts: 1,
  });
  if (!enqueued.ok) return enqueued;
  return { ...enqueued, mode };
}
