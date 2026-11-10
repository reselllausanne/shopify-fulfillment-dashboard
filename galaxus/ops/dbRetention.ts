import { prisma } from "@/app/lib/prisma";

/**
 * Bounded, throttled retention for append-only / payload-heavy tables that nothing reads once old:
 * - `GalaxusExportManifest.responseJson|validationIssuesJson` (~30 KB/row, readers only use the latest rows)
 * - `InventoryReconcileDrift` (2M rows; status route reads drifts of the latest reconcile only)
 * Rows of the manifest are kept (checksum/productCount/uploadStatus are used by upload dedupe + shrink guard).
 */
export const MANIFEST_PAYLOAD_RETENTION_DAYS = 30;
export const RECONCILE_DRIFT_RETENTION_DAYS = 30;
const BATCH_SIZE = 2000;
const MAX_BATCHES_PER_CALL = 10;
const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

let lastRunAtMs = 0;

function cutoffFor(nowMs: number, days: number) {
  return new Date(nowMs - Math.max(1, Math.floor(days)) * 24 * 60 * 60 * 1000);
}

export async function pruneExportManifestPayloads(nowMs = Date.now(), retentionDays = MANIFEST_PAYLOAD_RETENTION_DAYS) {
  const cutoff = cutoffFor(nowMs, retentionDays);
  let cleared = 0;
  for (let i = 0; i < MAX_BATCHES_PER_CALL; i++) {
    const n = await prisma.$executeRaw`
      UPDATE "GalaxusExportManifest" m
      SET "responseJson" = NULL, "validationIssuesJson" = NULL
      FROM (
        SELECT id FROM "GalaxusExportManifest"
        WHERE "createdAt" < ${cutoff}
          AND ("responseJson" IS NOT NULL OR "validationIssuesJson" IS NOT NULL)
        LIMIT ${BATCH_SIZE}
      ) b
      WHERE m.id = b.id
    `;
    cleared += Number(n) || 0;
    if (!n || Number(n) < BATCH_SIZE) break;
  }
  return cleared;
}

export async function pruneInventoryReconcileDrift(nowMs = Date.now(), retentionDays = RECONCILE_DRIFT_RETENTION_DAYS) {
  const cutoff = cutoffFor(nowMs, retentionDays);
  let deleted = 0;
  for (let i = 0; i < MAX_BATCHES_PER_CALL; i++) {
    const n = await prisma.$executeRaw`
      DELETE FROM "InventoryReconcileDrift" t
      USING (
        SELECT ctid FROM "InventoryReconcileDrift"
        WHERE "createdAt" < ${cutoff}
        LIMIT ${BATCH_SIZE * 5}
      ) b
      WHERE t.ctid = b.ctid
    `;
    deleted += Number(n) || 0;
    if (!n || Number(n) < BATCH_SIZE * 5) break;
  }
  return deleted;
}

export async function runDbRetention(options?: { force?: boolean; nowMs?: number }) {
  const nowMs = options?.nowMs ?? Date.now();
  if (!options?.force && nowMs - lastRunAtMs < MIN_INTERVAL_MS) {
    return { skipped: true, manifestCleared: 0, driftDeleted: 0 };
  }
  lastRunAtMs = nowMs;
  // Independent: one failing prune must not block the other.
  let manifestCleared = 0;
  let driftDeleted = 0;
  try {
    manifestCleared = await pruneExportManifestPayloads(nowMs);
  } catch (err) {
    console.error("[galaxus][ops][retention] manifest payload prune failed", err);
  }
  try {
    driftDeleted = await pruneInventoryReconcileDrift(nowMs);
  } catch (err) {
    console.error("[galaxus][ops][retention] reconcile drift prune failed", err);
  }
  return { skipped: false, manifestCleared, driftDeleted };
}

/** Test helper. */
export function __resetDbRetentionThrottle() {
  lastRunAtMs = 0;
}
