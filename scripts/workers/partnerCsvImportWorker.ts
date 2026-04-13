import os from "os";
import { unlink, readFile } from "fs/promises";
import { prisma } from "@/app/lib/prisma";
import { claimJob, completeJob, failJob, touchJob } from "@/galaxus/jobs/queue";
import {
  partnerCsvQueueFilePath,
  runPartnerCsvImport,
} from "@/galaxus/partners/partnerCsvImport";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type PartnerCsvImportJobPayload = {
  uploadId: string;
  partnerId: string;
  origin?: string | null;
  enrich?: boolean;
};

async function run() {
  const workerId = process.env.WORKER_ID || `${os.hostname()}-${process.pid}`;
  const pollMs = Math.max(Number(process.env.WORKER_POLL_MS ?? "2000"), 500);
  const jobType = process.env.WORKER_JOB_TYPE || "partner-csv-import";
  const groupLimit = Math.max(Number(process.env.WORKER_GROUP_LIMIT ?? "1"), 0);
  const heartbeatMs = Math.max(Number(process.env.WORKER_HEARTBEAT_MS ?? "60000"), 5000);

  console.info(`[worker] start ${workerId} (${jobType}) poll=${pollMs}ms`);

  const prismaAny = prisma as any;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const job = await claimJob(jobType, workerId, { groupLimit });
    if (!job) {
      await sleep(pollMs);
      continue;
    }

    const payload = (job.payloadJson || {}) as PartnerCsvImportJobPayload;
    const uploadId = payload.uploadId;
    const partnerId = payload.partnerId;
    if (!uploadId || !partnerId) {
      await failJob(job.id, "Invalid job payload (uploadId / partnerId)", false);
      continue;
    }
    const origin = payload.origin ?? null;
    const queuePath = partnerCsvQueueFilePath(uploadId);

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

      const row = await prismaAny.partnerUpload.findFirst({
        where: { id: uploadId, partnerId },
      });
      if (!row) {
        throw new Error("PartnerUpload not found or partner mismatch");
      }
      if (row.status === "COMPLETED" || row.status === "COMPLETED_WITH_ERRORS") {
        await unlink(queuePath).catch(() => {});
        await completeJob(job.id, { skipped: true, uploadId });
        console.info("[worker] job skipped (already completed)", { jobId: job.id, uploadId });
        continue;
      }

      await prismaAny.partnerUpload.update({
        where: { id: uploadId },
        data: { status: "PROCESSING" },
      });

      let csvText: string;
      try {
        csvText = await readFile(queuePath, "utf8");
      } catch {
        throw new Error("Queued CSV file missing (already processed or disk issue)");
      }

      const result = await runPartnerCsvImport(csvText, {
        partnerId,
        uploadId,
        dryRun: false,
        origin,
        enrich: payload.enrich ?? false,
      });

      await unlink(queuePath).catch(() => {});
      await completeJob(job.id, {
        uploadId,
        importedRows: result.importedRows,
        newRows: result.newRows,
        errorRows: result.errorRows,
        enrichJobId: result.enrichJobId,
      });
      console.info("[worker] partner CSV import completed", {
        jobId: job.id,
        uploadId,
        importedRows: result.importedRows,
      });
    } catch (error: any) {
      const message = error?.message ?? "Job failed";
      const retry = job.attempts < job.maxAttempts;
      await failJob(job.id, message, retry);
      console.error("[worker] job failed", { jobId: job.id, error: message, retry });
      if (!retry) {
        await prismaAny.partnerUpload
          .update({
            where: { id: uploadId },
            data: {
              status: "FAILED",
              errorsJson: [{ message }],
            },
          })
          .catch((e: any) => console.warn("[worker] failed to mark upload FAILED", e?.message ?? e));
        await unlink(queuePath).catch(() => {});
      }
    } finally {
      if (stopHeartbeat) stopHeartbeat();
    }
  }
}

void run();
