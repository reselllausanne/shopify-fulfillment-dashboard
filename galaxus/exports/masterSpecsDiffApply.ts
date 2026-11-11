import { prisma } from "@/app/lib/prisma";
import { withTransientDbRetry } from "@/galaxus/exports/transientDbRetry";
import {
  SNAPSHOT_BUCKET_PREFIX_LEN,
  SNAPSHOT_MAX_DIFF_BUCKETS,
  countByBucket,
  diffBuckets,
} from "@/galaxus/exports/snapshotDeleteReconcile";

/**
 * Master/specs snapshot rebuild writer: upsert only changed rows, sweep what disappeared.
 *
 * Replaces "DELETE all (900k master + 3M specs) → INSERT all" which cost hours of WAL/index
 * churn per rebuild and left both tables empty (and the snapshot flagged not-ready, so master
 * uploads fell back to the live full-catalog export) for the whole materialize phase.
 *
 * Only `rebuildMasterSpecsSnapshot` writes these tables (no live patches), so no race guard is
 * needed. Semantics kept from createMany(skipDuplicates): first occurrence of a key wins.
 * Tables are never truncated; a crash leaves a consistent superset of old/new rows.
 */

type MasterTable = "GalaxusFeedMasterSnapshot";
type SpecsTable = "GalaxusFeedSpecsSnapshot";

export const MASTER_SPECS_DIFF_CHUNK = 2000;
const DELETE_CHUNK = 2000;
const SEP = "\u0000";

export type MasterRowInput = {
  providerKey: string;
  gtin: string | null;
  supplierKey: string | null;
  rowJson: Record<string, string>;
};

export type SpecsRowInput = {
  providerKey: string;
  specificationKey: string;
  rowJson: Record<string, string>;
};

export class MasterSpecsDiffWriter {
  readonly seenMaster = new Set<string>();
  readonly seenSpecs = new Set<string>();
  masterWritten = 0;
  specsWritten = 0;

  /** Returns number of distinct keys accepted from this batch (first occurrence wins). */
  async upsertMaster(rows: MasterRowInput[]): Promise<number> {
    const fresh: MasterRowInput[] = [];
    for (const row of rows) {
      if (!row.providerKey || this.seenMaster.has(row.providerKey)) continue;
      this.seenMaster.add(row.providerKey);
      fresh.push(row);
    }
    for (let i = 0; i < fresh.length; i += MASTER_SPECS_DIFF_CHUNK) {
      const chunk = fresh.slice(i, i + MASTER_SPECS_DIFF_CHUNK);
      const n = await withTransientDbRetry<number>("master-diff-upsert", () =>
        (prisma as any).$executeRawUnsafe(
          `INSERT INTO "GalaxusFeedMasterSnapshot" ("providerKey", "gtin", "supplierKey", "rowJson", "updatedAt")
           SELECT t.k, NULLIF(t.g, ''), NULLIF(t.s, ''), t.v::jsonb, $5::timestamp
           FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS t(k, g, s, v)
           ON CONFLICT ("providerKey") DO UPDATE
             SET "gtin" = EXCLUDED."gtin", "supplierKey" = EXCLUDED."supplierKey",
                 "rowJson" = EXCLUDED."rowJson", "updatedAt" = EXCLUDED."updatedAt"
             WHERE ("GalaxusFeedMasterSnapshot"."rowJson", "GalaxusFeedMasterSnapshot"."gtin", "GalaxusFeedMasterSnapshot"."supplierKey")
               IS DISTINCT FROM (EXCLUDED."rowJson", EXCLUDED."gtin", EXCLUDED."supplierKey")`,
          chunk.map((r) => r.providerKey),
          chunk.map((r) => r.gtin ?? ""),
          chunk.map((r) => r.supplierKey ?? ""),
          chunk.map((r) => JSON.stringify(r.rowJson)),
          new Date()
        )
      );
      this.masterWritten += Number(n) || 0;
    }
    return fresh.length;
  }

  async upsertSpecs(rows: SpecsRowInput[]): Promise<number> {
    const fresh: SpecsRowInput[] = [];
    for (const row of rows) {
      if (!row.providerKey || !row.specificationKey) continue;
      const id = `${row.providerKey}${SEP}${row.specificationKey}`;
      if (this.seenSpecs.has(id)) continue;
      this.seenSpecs.add(id);
      fresh.push(row);
    }
    for (let i = 0; i < fresh.length; i += MASTER_SPECS_DIFF_CHUNK) {
      const chunk = fresh.slice(i, i + MASTER_SPECS_DIFF_CHUNK);
      const n = await withTransientDbRetry<number>("specs-diff-upsert", () =>
        (prisma as any).$executeRawUnsafe(
          `INSERT INTO "GalaxusFeedSpecsSnapshot" ("providerKey", "specificationKey", "rowJson", "updatedAt")
           SELECT t.k, t.s, t.v::jsonb, $4::timestamp
           FROM unnest($1::text[], $2::text[], $3::text[]) AS t(k, s, v)
           ON CONFLICT ("providerKey", "specificationKey") DO UPDATE
             SET "rowJson" = EXCLUDED."rowJson", "updatedAt" = EXCLUDED."updatedAt"
             WHERE "GalaxusFeedSpecsSnapshot"."rowJson" IS DISTINCT FROM EXCLUDED."rowJson"`,
          chunk.map((r) => r.providerKey),
          chunk.map((r) => r.specificationKey),
          chunk.map((r) => JSON.stringify(r.rowJson)),
          new Date()
        )
      );
      this.specsWritten += Number(n) || 0;
    }
    return fresh.length;
  }

  /** Delete rows the rebuild did not emit. Call only after the build fully succeeded. */
  async sweep(): Promise<{ masterDeleted: number; specsDeleted: number }> {
    const masterStale = await findStale("GalaxusFeedMasterSnapshot", this.seenMaster, false);
    const masterDeleted = await deleteStale("GalaxusFeedMasterSnapshot", masterStale);
    const specsStale = await findStale("GalaxusFeedSpecsSnapshot", this.seenSpecs, true);
    const specsDeleted = await deleteStale("GalaxusFeedSpecsSnapshot", specsStale);
    return { masterDeleted, specsDeleted };
  }
}

/** Stale = [providerKey] (master) or [providerKey, specificationKey] (specs). */
async function findStale(
  table: MasterTable | SpecsTable,
  seen: Set<string>,
  composite: boolean
): Promise<string[][]> {
  const prismaAny = prisma as any;
  const len = SNAPSHOT_BUCKET_PREFIX_LEN;
  const seenProviderKeys = composite
    ? (function* () {
        for (const id of seen) yield id.slice(0, id.indexOf(SEP));
      })()
    : seen.values();

  const bucketRows: Array<{ b: string | null; c: number | bigint }> = await withTransientDbRetry(
    "master-diff-bucket-counts",
    () =>
      prismaAny.$queryRawUnsafe(
        `SELECT left("providerKey", ${len}) AS b, count(*)::int AS c FROM "${table}" GROUP BY 1`
      )
  );
  const dbBuckets = new Map<string, number>();
  for (const r of bucketRows) dbBuckets.set(String(r.b ?? ""), Number(r.c));
  const differing = diffBuckets(countByBucket(seenProviderKeys, len), dbBuckets);
  if (differing.length === 0) return [];

  const full = differing.length > SNAPSHOT_MAX_DIFF_BUCKETS;
  const cols = composite ? `"providerKey", "specificationKey"` : `"providerKey"`;
  const rows: Array<{ providerKey: string; specificationKey?: string }> = await withTransientDbRetry(
    "master-diff-key-pull",
    () =>
      full
        ? prismaAny.$queryRawUnsafe(`SELECT ${cols} FROM "${table}"`)
        : prismaAny.$queryRawUnsafe(
            `SELECT ${cols} FROM "${table}" WHERE left("providerKey", ${len}) = ANY($1::text[])`,
            differing
          )
  );
  const out: string[][] = [];
  for (const r of rows) {
    const id = composite ? `${r.providerKey}${SEP}${r.specificationKey}` : r.providerKey;
    if (seen.has(id)) continue;
    out.push(composite ? [r.providerKey, String(r.specificationKey)] : [r.providerKey]);
  }
  return out;
}

async function deleteStale(table: MasterTable | SpecsTable, stale: string[][]): Promise<number> {
  const prismaAny = prisma as any;
  let deleted = 0;
  for (let i = 0; i < stale.length; i += DELETE_CHUNK) {
    const chunk = stale.slice(i, i + DELETE_CHUNK);
    const n = await withTransientDbRetry<number>("master-diff-delete", () =>
      table === "GalaxusFeedMasterSnapshot"
        ? prismaAny.$executeRawUnsafe(
            `DELETE FROM "GalaxusFeedMasterSnapshot" WHERE "providerKey" = ANY($1::text[])`,
            chunk.map((k) => k[0])
          )
        : prismaAny.$executeRawUnsafe(
            `DELETE FROM "GalaxusFeedSpecsSnapshot" s USING unnest($1::text[], $2::text[]) AS t(k, sk)
             WHERE s."providerKey" = t.k AND s."specificationKey" = t.sk`,
            chunk.map((k) => k[0]),
            chunk.map((k) => k[1])
          )
    );
    deleted += Number(n) || 0;
  }
  return deleted;
}
