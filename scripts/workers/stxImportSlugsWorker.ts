import os from "os";
import { claimJob, completeJob, enqueueJob, failJob, touchJob } from "@/galaxus/jobs/queue";
import { runStxImportSlugsSyncBatch } from "@/galaxus/stx/importSlugsSyncJob";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type StxImportSlugsSyncJobPayload = {
  batchSize?: number;
  concurrency?: number;
  autoDrain?: boolean;
};

async function run() {
  const workerId = process.env.WORKER_ID || `${os.hostname()}-${process.pid}`;
  const pollMs = Math.max(Number(process.env.WORKER_POLL_MS ?? "2000"), 500);
  const jobType = process.env.WORKER_JOB_TYPE || "stx-import-slugs-sync";
  const groupLimit = Math.max(Number(process.env.WORKER_GROUP_LIMIT ?? "6"), 0);
  const heartbeatMs = Math.max(Number(process.env.WORKER_HEARTBEAT_MS ?? "60000"), 5000);
  const defaultConcurrency = Math.min(Math.max(Number(process.env.STX_IMPORT_SYNC_CONCURRENCY ?? "6"), 1), 20);
  const defaultBatchSize = Math.min(Math.max(Number(process.env.STX_IMPORT_SYNC_BATCH_SIZE ?? "120"), 1), 500);

  console.info(
    `[worker] start ${workerId} (${jobType}) poll=${pollMs}ms concurrency=${defaultConcurrency} batch=${defaultBatchSize}`
  );

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

      const payload = (job.payloadJson || {}) as StxImportSlugsSyncJobPayload;
      const result = await runStxImportSlugsSyncBatch({
        batchSize: payload.batchSize ?? defaultBatchSize,
        concurrency: payload.concurrency ?? defaultConcurrency,
        workerId,
      });
      await completeJob(job.id, { ...payload, result });
      console.info("[worker] stx slug sync batch completed", {
        jobId: job.id,
        claimed: result.claimed,
        imported: result.imported,
        errored: result.errored,
        pending: result.counts.pending,
        durationMs: result.durationMs,
      });

      const autoDrain = payload.autoDrain !== false;
      if (autoDrain && result.claimed > 0 && result.counts.pending > 0) {
        await enqueueJob(
          jobType,
          {
            batchSize: payload.batchSize ?? defaultBatchSize,
            concurrency: payload.concurrency ?? defaultConcurrency,
            autoDrain: true,
          },
          { priority: 0, groupKey: job.groupKey ?? "stx-import-slugs-sync" }
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
