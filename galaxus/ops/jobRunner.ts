import { runJob } from "@/galaxus/jobs/jobRunner";
import type { OpsJobKey } from "./types";

export async function runOpsJob<T>(
  jobKey: OpsJobKey | string,
  handler: () => Promise<T>
): Promise<{ success: boolean; result?: T; error?: string }> {
  try {
    const res = await runJob(`ops-${jobKey}`, handler);
    if (!res?.success) {
      return { success: false, error: res?.error ?? "Job failed" };
    }
    return { success: true, result: res?.result as T };
  } catch (error: any) {
    return { success: false, error: error?.message ?? "Job failed" };
  }
}
