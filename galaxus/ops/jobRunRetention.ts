import { prisma } from "@/app/lib/prisma";

/**
 * `GalaxusJobRun.resultJson` for `feeds-upload` averages ~140 KB/row (17k rows ≈ 1.4 GB).
 * Keep the run history (who/when/success/error) forever, but drop the heavy payload once it
 * is no longer useful for debugging.
 */
export const JOB_RUN_PAYLOAD_RETENTION_DAYS = 14;
const BATCH_SIZE = 2000;
const MAX_BATCHES_PER_CALL = 10;
const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

let lastPruneAtMs = 0;

export async function pruneGalaxusJobRunPayloads(options?: {
  retentionDays?: number;
  force?: boolean;
  nowMs?: number;
}): Promise<{ skipped: boolean; cleared: number }> {
  const nowMs = options?.nowMs ?? Date.now();
  if (!options?.force && nowMs - lastPruneAtMs < MIN_INTERVAL_MS) {
    return { skipped: true, cleared: 0 };
  }
  lastPruneAtMs = nowMs;

  const days = Math.max(1, Math.floor(options?.retentionDays ?? JOB_RUN_PAYLOAD_RETENTION_DAYS));
  const cutoff = new Date(nowMs - days * 24 * 60 * 60 * 1000);

  let cleared = 0;
  for (let i = 0; i < MAX_BATCHES_PER_CALL; i++) {
    // Small batches keep each statement short (statement_timeout) and WAL bursts low.
    const n = await prisma.$executeRaw`
      UPDATE "GalaxusJobRun" r
      SET "resultJson" = NULL
      FROM (
        SELECT id FROM "GalaxusJobRun"
        WHERE "resultJson" IS NOT NULL
          AND "createdAt" < ${cutoff}
        ORDER BY "createdAt"
        LIMIT ${BATCH_SIZE}
      ) b
      WHERE r.id = b.id
    `;
    cleared += Number(n) || 0;
    if (!n || Number(n) < BATCH_SIZE) break;
  }
  return { skipped: false, cleared };
}

/** Test helper. */
export function __resetJobRunRetentionThrottle() {
  lastPruneAtMs = 0;
}
