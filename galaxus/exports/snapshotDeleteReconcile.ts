import { prisma } from "@/app/lib/prisma";
import { withTransientDbRetry } from "@/galaxus/exports/transientDbRetry";

/**
 * Detect rows deleted from a feed snapshot table WITHOUT pulling every key.
 *
 * Why: `loadSnapshotCsv` keeps the snapshot on local disk and only pulls rows newer than a
 * watermark. Deletes (patch removes keys the live export stopped emitting) show up as a
 * row-count mismatch, which used to trigger a key-only pull of ALL ~1.66M keys (~45 MB per
 * scope, ~2 pulls per feed run). Keys are 17-char ASCII, so grouping by a 10-char prefix
 * gives ~10k buckets (~200 KB): only buckets whose count differs from the cache need their
 * keys pulled (~150 keys each).
 *
 * Fail-safe: the caller still verifies `rows.size === dbCount` afterwards and falls back to
 * a full reload on any drift, so a wrong diff can never serve stale rows silently.
 */
export const SNAPSHOT_BUCKET_PREFIX_LEN = 10;
/** More differing buckets than this → just pull all keys (cheaper than a huge ANY list). */
export const SNAPSHOT_MAX_DIFF_BUCKETS = 2000;

export type SnapshotTableName = "GalaxusFeedStockSnapshot" | "GalaxusFeedOfferSnapshot";

// Closed set: these names are interpolated into SQL (identifiers cannot be bound).
const ALLOWED_TABLES: ReadonlySet<string> = new Set([
  "GalaxusFeedStockSnapshot",
  "GalaxusFeedOfferSnapshot",
]);

export function bucketOfKey(key: string, len = SNAPSHOT_BUCKET_PREFIX_LEN): string {
  return key.slice(0, len);
}

export function countByBucket(keys: Iterable<string>, len = SNAPSHOT_BUCKET_PREFIX_LEN): Map<string, number> {
  const out = new Map<string, number>();
  for (const key of keys) {
    const b = bucketOfKey(key, len);
    out.set(b, (out.get(b) ?? 0) + 1);
  }
  return out;
}

/** Buckets whose row count differs between cache and DB (including buckets present on one side only). */
export function diffBuckets(cache: Map<string, number>, db: Map<string, number>): string[] {
  const diff: string[] = [];
  for (const [bucket, count] of db) {
    if ((cache.get(bucket) ?? 0) !== count) diff.push(bucket);
  }
  for (const [bucket, count] of cache) {
    if (!db.has(bucket) && count > 0) diff.push(bucket);
  }
  return diff;
}

/**
 * Remove from `rows` the keys that no longer exist in `table`.
 * Returns `null` when the cheap path is not applicable (caller must use the full key pull).
 */
export async function reconcileDeletedKeysByBucket(
  table: SnapshotTableName,
  rows: Map<string, unknown>
): Promise<{ removed: number; bucketsPulled: number; keysPulled: number } | null> {
  if (!ALLOWED_TABLES.has(table)) return null;
  const prismaAny = prisma as any;
  const len = SNAPSHOT_BUCKET_PREFIX_LEN;

  const dbBucketRows: Array<{ b: string | null; c: number | bigint }> = await withTransientDbRetry(
    "snapshot-bucket-counts",
    () =>
      prismaAny.$queryRawUnsafe(
        `SELECT left("providerKey", ${len}) AS b, count(*)::int AS c FROM "${table}" GROUP BY 1`
      )
  );
  const dbBuckets = new Map<string, number>();
  for (const row of dbBucketRows) dbBuckets.set(String(row.b ?? ""), Number(row.c));

  const differing = diffBuckets(countByBucket(rows.keys(), len), dbBuckets);
  if (differing.length === 0) return { removed: 0, bucketsPulled: 0, keysPulled: 0 };
  if (differing.length > SNAPSHOT_MAX_DIFF_BUCKETS) return null;

  const keyRows: Array<{ providerKey: string }> = await withTransientDbRetry(
    "snapshot-bucket-key-pull",
    () =>
      prismaAny.$queryRawUnsafe(
        `SELECT "providerKey" FROM "${table}" WHERE left("providerKey", ${len}) = ANY($1::text[])`,
        differing
      )
  );
  const keep = new Set(keyRows.map((r) => r.providerKey));
  const differingSet = new Set(differing);
  let removed = 0;
  for (const key of Array.from(rows.keys())) {
    if (differingSet.has(bucketOfKey(key, len)) && !keep.has(key)) {
      rows.delete(key);
      removed += 1;
    }
  }
  return { removed, bucketsPulled: differing.length, keysPulled: keyRows.length };
}
