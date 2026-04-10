import os from "os";
import { claimJob, completeJob, enqueueJob, failJob, touchJob } from "@/galaxus/jobs/queue";
import { runKickdbEnrichMissing } from "@/galaxus/kickdb/enrichMissingJob";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type KickdbEnrichJobPayload = {
  limit?: number;
  concurrency?: number;
  supplierVariantIdPrefix?: string | null;
  includeNotFound?: boolean;
  respectRecentRun?: boolean;
  force?: boolean;
  autoDrain?: boolean;
  partnerId?: string;
};

async function run() {
  const workerId = process.env.WORKER_ID || `${os.hostname()}-${process.pid}`;
  const pollMs = Math.max(Number(process.env.WORKER_POLL_MS ?? "2000"), 500);
  const jobType = process.env.WORKER_JOB_TYPE || "kickdb-enrich-missing";
  const groupLimit = Math.max(Number(process.env.WORKER_GROUP_LIMIT ?? "1"), 0);
  const heartbeatMs = Math.max(Number(process.env.WORKER_HEARTBEAT_MS ?? "60000"), 5000);

  console.info(`[worker] start ${workerId} (${jobType}) poll=${pollMs}ms`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const job = await claimJob(jobType, workerId, { groupLimit });
    if (!job) {
      await sleep(pollMs);
      continue;
    }

    let stopHeartbeat: (() => void) | null = null;
    try {
      if (heartbeatMs > 0) {
        const tick = async () => {
          try {
            await touchJob(job.id, workerId);
          } catch (error: any) {
            console.warn("[worker] heartbeat failed", { jobId: job.id, error: error?.message ?? error });
          }
        };
        await tick();
        const interval = setInterval(tick, heartbeatMs);
        stopHeartbeat = () => clearInterval(interval);
      }

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

      const autoDrain = payload.autoDrain !== false;
      const limit = Math.max(Number(payload.limit ?? 0), 0);
      if (autoDrain && limit > 0 && result.candidates >= limit && result.processed > 0) {
        await enqueueJob(
          jobType,
          { ...payload },
          { priority: 0, groupKey: job.groupKey ?? null }
        );
      }
    } catch (error: any) {
      const message = error?.message ?? "Job failed";
      const retry = job.attempts < job.maxAttempts;
      await failJob(job.id, message, retry);
      console.error("[worker] job failed", { jobId: job.id, error: message, retry });
    } finally {
      if (stopHeartbeat) stopHeartbeat();
    }
  }
}

void run();
