import os from "os";
import { claimJob, completeJob, enqueueJob, failJob } from "@/galaxus/jobs/queue";
import { runPartnerUploadEnrich } from "@/galaxus/partners/enrichUploadJob";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type PartnerEnrichJobPayload = {
  partnerKey: string;
  limit?: number;
  force?: boolean;
  autoDrain?: boolean;
  origin?: string | null;
};

async function run() {
  const workerId = process.env.WORKER_ID || `${os.hostname()}-${process.pid}`;
  const pollMs = Math.max(Number(process.env.WORKER_POLL_MS ?? "2000"), 500);
  const jobType = process.env.WORKER_JOB_TYPE || "partner-upload-enrich";
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
      const payload = (job.payloadJson || {}) as PartnerEnrichJobPayload;
      const result = await runPartnerUploadEnrich({
        partnerKey: payload.partnerKey,
        limit: payload.limit,
        force: payload.force,
        origin: payload.origin ?? null,
        debug: false,
      });
      await completeJob(job.id, { ...payload, result });
      console.info("[worker] job completed", { jobId: job.id, processed: result.processed });

      const autoDrain = payload.autoDrain !== false;
      const limit = Math.max(Number(payload.limit ?? 0), 0);
      if (autoDrain && limit > 0 && result.candidates >= limit && result.processed > 0) {
        await enqueueJob(
          jobType,
          { ...payload },
          { priority: 0, groupKey: job.groupKey ?? payload.partnerKey ?? null }
        );
      }
    } catch (error: any) {
      const message = error?.message ?? "Job failed";
      const retry = job.attempts < job.maxAttempts;
      await failJob(job.id, message, retry);
      console.error("[worker] job failed", { jobId: job.id, error: message, retry });
    }
  }
}

void run();
