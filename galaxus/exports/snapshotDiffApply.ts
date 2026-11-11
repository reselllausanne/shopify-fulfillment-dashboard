import { prisma } from "@/app/lib/prisma";
import { withTransientDbRetry } from "@/galaxus/exports/transientDbRetry";
import {
  SNAPSHOT_BUCKET_PREFIX_LEN,
  SNAPSHOT_MAX_DIFF_BUCKETS,
  countByBucket,
  diffBuckets,
  bucketOfKey,
  type SnapshotTableName,
} from "@/galaxus/exports/snapshotDeleteReconcile";

/**
 * Diff-apply a freshly exported feed (stock or offer) onto its snapshot table.
 *
 * Replaces "DELETE all 1.66M rows, INSERT 1.66M rows" (hours of WAL/index churn, table bloat,
 * and a window where the table is empty so the snapshot had to be invalidated and every feed
 * push fell back to a slow live export) with:
 *
 *  1. Guarded upsert per chunk. Postgres compares `rowJson` itself; unchanged rows are not
 *     written at all (no WAL, no dead tuple, `updatedAt` untouched so incremental readers do
 *     not re-pull them). Typical nightly delta: a few percent of rows.
 *  2. Delete only keys the export no longer emits, found via per-prefix counts (cheap) instead
 *     of pulling every key.
 *
 * Race safety vs live patches (`patchFeedSnapshotsForProviderKeys`): the export was computed at
 * `exportStartedAt`. A row patched after that has `updatedAt > exportStartedAt` and is fresher
 * than the export value, so neither the upsert (`WHERE updatedAt <= exportStartedAt`) nor the
 * delete (`updatedAt <= exportStartedAt`) may touch it. That is what lets the snapshot stay
 * valid (readers + patches keep working) during the whole rebuild.
 *
 * The table is never truncated, so a crash mid-way leaves a consistent superset of old/new
 * rows (never a short feed that would delist products).
 */

const ALLOWED_TABLES: ReadonlySet<string> = new Set([
  "GalaxusFeedStockSnapshot",
  "GalaxusFeedOfferSnapshot",
]);

export const SNAPSHOT_DIFF_CHUNK_SIZE = 2000;
const DELETE_CHUNK_SIZE = 2000;

export type SnapshotDiffResult = {
  /** Distinct keys in the export. */
  keys: number;
  /** Rows inserted or changed (written). */
  written: number;
  /** Keys deleted because the export no longer emits them. */
  deleted: number;
  /** Duplicate ProviderKeys dropped (first wins, like createMany skipDuplicates). */
  duplicates: number;
};

function assertTable(table: string): asserts table is SnapshotTableName {
  if (!ALLOWED_TABLES.has(table)) throw new Error(`snapshot diff: table not allowed: ${table}`);
}

export function dedupeRowsByProviderKey(rows: Array<Record<string, string>>): {
  unique: Map<string, Record<string, string>>;
  duplicates: number;
} {
  const unique = new Map<string, Record<string, string>>();
  let duplicates = 0;
  for (const row of rows) {
    const key = String(row.ProviderKey ?? "").trim();
    if (!key) continue;
    if (unique.has(key)) {
      duplicates += 1;
      continue;
    }
    unique.set(key, row);
  }
  return { unique, duplicates };
}

export async function upsertChangedSnapshotRows(
  table: SnapshotTableName,
  entries: Array<[string, Record<string, string>]>,
  exportStartedAt: Date
): Promise<number> {
  assertTable(table);
  if (entries.length === 0) return 0;
  const keys = entries.map(([k]) => k);
  const values = entries.map(([, row]) => JSON.stringify(row));
  // Timestamp per chunk (not per rebuild) so incremental readers' watermark advances with
  // the writes instead of sitting at the rebuild start.
  const writtenAt = new Date();
  const affected = await withTransientDbRetry<number>("snapshot-diff-upsert", () =>
    (prisma as any).$executeRawUnsafe(
      `INSERT INTO "${table}" ("providerKey", "rowJson", "updatedAt")
       SELECT t.k, t.v::jsonb, $3::timestamp
       FROM unnest($1::text[], $2::text[]) AS t(k, v)
       ON CONFLICT ("providerKey") DO UPDATE
         SET "rowJson" = EXCLUDED."rowJson", "updatedAt" = EXCLUDED."updatedAt"
         WHERE "${table}"."rowJson" IS DISTINCT FROM EXCLUDED."rowJson"
           AND "${table}"."updatedAt" <= $4::timestamp`,
      keys,
      values,
      writtenAt,
      exportStartedAt
    )
  );
  return Number(affected) || 0;
}

/**
 * Keys present in `table` but not in `keep`, untouched since `olderThan`.
 * Per-prefix counts first (~200 KB); full key pull only if many buckets differ.
 */
export async function findStaleSnapshotKeys(
  table: SnapshotTableName,
  keep: Map<string, unknown>,
  olderThan: Date
): Promise<string[]> {
  assertTable(table);
  const prismaAny = prisma as any;
  const len = SNAPSHOT_BUCKET_PREFIX_LEN;

  const bucketRows: Array<{ b: string | null; c: number | bigint }> = await withTransientDbRetry(
    "snapshot-diff-bucket-counts",
    () =>
      prismaAny.$queryRawUnsafe(
        `SELECT left("providerKey", ${len}) AS b, count(*)::int AS c FROM "${table}" GROUP BY 1`
      )
  );
  const dbBuckets = new Map<string, number>();
  for (const row of bucketRows) dbBuckets.set(String(row.b ?? ""), Number(row.c));

  const differing = diffBuckets(countByBucket(keep.keys(), len), dbBuckets);
  if (differing.length === 0) return [];

  const full = differing.length > SNAPSHOT_MAX_DIFF_BUCKETS;
  const rows: Array<{ providerKey: string }> = await withTransientDbRetry(
    "snapshot-diff-key-pull",
    () =>
      full
        ? prismaAny.$queryRawUnsafe(
            `SELECT "providerKey" FROM "${table}" WHERE "updatedAt" <= $1::timestamp`,
            olderThan
          )
        : prismaAny.$queryRawUnsafe(
            `SELECT "providerKey" FROM "${table}"
             WHERE left("providerKey", ${len}) = ANY($1::text[]) AND "updatedAt" <= $2::timestamp`,
            differing,
            olderThan
          )
  );
  const differingSet = new Set(differing);
  return rows
    .map((r) => r.providerKey)
    .filter((key) => !keep.has(key) && (full || differingSet.has(bucketOfKey(key, len))));
}

export async function deleteSnapshotKeys(
  table: SnapshotTableName,
  keys: string[],
  olderThan: Date
): Promise<number> {
  assertTable(table);
  let deleted = 0;
  for (let i = 0; i < keys.length; i += DELETE_CHUNK_SIZE) {
    const chunk = keys.slice(i, i + DELETE_CHUNK_SIZE);
    const n = await withTransientDbRetry<number>("snapshot-diff-delete", () =>
      (prisma as any).$executeRawUnsafe(
        `DELETE FROM "${table}" WHERE "providerKey" = ANY($1::text[]) AND "updatedAt" <= $2::timestamp`,
        chunk,
        olderThan
      )
    );
    deleted += Number(n) || 0;
  }
  return deleted;
}

export async function applySnapshotDiff(params: {
  table: SnapshotTableName;
  rows: Array<Record<string, string>>;
  /** When the export that produced `rows` started (patches newer than this win). */
  exportStartedAt: Date;
}): Promise<SnapshotDiffResult> {
  assertTable(params.table);
  const { unique, duplicates } = dedupeRowsByProviderKey(params.rows);
  if (unique.size === 0) {
    // Never wipe a table from an empty export — caller already refuses, defend anyway.
    throw new Error(`snapshot diff: refusing to apply empty export to ${params.table}`);
  }

  const entries = Array.from(unique.entries());
  let written = 0;
  for (let offset = 0; offset < entries.length; offset += SNAPSHOT_DIFF_CHUNK_SIZE) {
    written += await upsertChangedSnapshotRows(
      params.table,
      entries.slice(offset, offset + SNAPSHOT_DIFF_CHUNK_SIZE),
      params.exportStartedAt
    );
  }

  const stale = await findStaleSnapshotKeys(params.table, unique, params.exportStartedAt);
  const deleted = await deleteSnapshotKeys(params.table, stale, params.exportStartedAt);

  return { keys: unique.size, written, deleted, duplicates };
}
