import os from "os";
import { claimJob, completeJob, failJob } from "@/galaxus/jobs/queue";
import { runKickdbEnrichMissing } from "@/galaxus/kickdb/enrichMissingJob";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type KickdbEnrichJobPayload = {
  limit?: number;
  concurrency?: number;
  supplierVariantIdPrefix?: string | null;
  includeNotFound?: boolean;
  respectRecentRun?: boolean;
  force?: boolean;
};

async function run() {
  const workerId = process.env.WORKER_ID || `${os.hostname()}-${process.pid}`;
  const pollMs = Math.max(Number(process.env.WORKER_POLL_MS ?? "2000"), 500);
  const jobType = process.env.WORKER_JOB_TYPE || "kickdb-enrich-missing";
  const groupLimit = Math.max(Number(process.env.WORKER_GROUP_LIMIT ?? "1"), 0);

  console.info(`[worker] start ${workerId} (${jobType}) poll=${pollMs}ms`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const job = await claimJob(jobType, workerId, { groupLimit });
    if (!job) {
      await sleep(pollMs);
      continue;
    }

    try {
      const payload = (job.payloadJson || {}) as KickdbEnrichJobPayload;
      const result = await runKickdbEnrichMissing({
        limit: payload.limit,
        concurrency: payload.concurrency,
        supplierVariantIdPrefix: payload.supplierVariantIdPrefix ?? null,
        includeNotFound: payload.includeNotFound !== false,
        respectRecentRun: payload.respectRecentRun !== false,
        force: payload.force ?? false,
      });
      await completeJob(job.id, { ...payload, result });
      console.info("[worker] job completed", { jobId: job.id, processed: result.processed });
    } catch (error: any) {
      const message = error?.message ?? "Job failed";
      const retry = job.attempts < job.maxAttempts;
      await failJob(job.id, message, retry);
      console.error("[worker] job failed", { jobId: job.id, error: message, retry });
    }
  }
}

void run();
