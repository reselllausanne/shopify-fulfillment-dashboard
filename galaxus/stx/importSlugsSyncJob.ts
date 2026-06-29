import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { createLimiter } from "@/galaxus/jobs/bulkSql";
import { importStxProductByInput } from "@/galaxus/stx/importProduct";
import { getStxImportSlugCounts } from "@/galaxus/stx/importSlugsBulk";

export type StxImportSlugsSyncOptions = {
  batchSize?: number;
  concurrency?: number;
  workerId?: string;
  staleLockMs?: number;
};

export type StxImportSlugsSyncResult = {
  claimed: number;
  imported: number;
  errored: number;
  releasedStaleLocks: number;
  durationMs: number;
  counts: Awaited<ReturnType<typeof getStxImportSlugCounts>>;
  errorSamples: Array<{ slug: string; error: string }>;
  errorSummary: Record<string, number>;
};

type ClaimedSlugRow = {
  id: string;
  slug: string;
  input: string;
};

async function releaseStaleSyncLocks(staleLockMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - staleLockMs);
  const result = await prisma.$executeRaw(Prisma.sql`
    UPDATE "public"."StxImportSlug"
    SET "syncLockedAt" = NULL, "syncLockedBy" = NULL
    WHERE "status" = CAST('PENDING'::text AS "public"."StxImportSlugStatus")
      AND "syncLockedAt" IS NOT NULL
      AND "syncLockedAt" < ${cutoff}
  `);
  return Number(result ?? 0);
}

async function claimPendingSlugs(batchSize: number, workerId: string): Promise<ClaimedSlugRow[]> {
  return prisma.$queryRaw<ClaimedSlugRow[]>(Prisma.sql`
    UPDATE "public"."StxImportSlug" AS s
    SET
      "syncLockedAt" = NOW(),
      "syncLockedBy" = ${workerId}
    FROM (
      SELECT id
      FROM "public"."StxImportSlug"
      WHERE "status" = CAST('PENDING'::text AS "public"."StxImportSlugStatus")
        AND "syncLockedAt" IS NULL
      ORDER BY "createdAt" ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    ) picked
    WHERE s.id = picked.id
    RETURNING s.id, s.slug, s.input
  `);
}

async function finalizeSlugSync(
  row: ClaimedSlugRow,
  ok: boolean,
  message: string | null
): Promise<void> {
  const prismaAny = prisma as any;
  if (ok) {
    await prismaAny.stxImportSlug.update({
      where: { id: row.id },
      data: {
        status: "IMPORTED",
        importedAt: new Date(),
        lastError: null,
        syncLockedAt: null,
        syncLockedBy: null,
      },
    });
    return;
  }

  await prismaAny.stxImportSlug.update({
    where: { id: row.id },
    data: {
      status: "ERROR",
      lastError: message ?? "Import failed",
      syncLockedAt: null,
      syncLockedBy: null,
    },
  });
}

export async function runStxImportSlugsSyncBatch(
  options: StxImportSlugsSyncOptions = {}
): Promise<StxImportSlugsSyncResult> {
  const startedAt = Date.now();
  const batchSize = Math.min(Math.max(Number(options.batchSize ?? 120), 1), 1000);
  const concurrency = Math.min(Math.max(Number(options.concurrency ?? 6), 1), 20);
  const workerId = String(options.workerId ?? "stx-sync").trim() || "stx-sync";
  const staleLockMs = Math.max(Number(options.staleLockMs ?? 15 * 60 * 1000), 60_000);

  const releasedStaleLocks = await releaseStaleSyncLocks(staleLockMs);
  const claimed = await claimPendingSlugs(batchSize, workerId);

  let imported = 0;
  let errored = 0;
  const errorSamples: Array<{ slug: string; error: string }> = [];
  const errorSummary: Record<string, number> = {};
  const limit = createLimiter(concurrency);

  const recordError = (slug: string, message: string) => {
    const key =
      message.includes("no express") || message.includes("no express/usable price")
        ? "no_express_price"
        : message.includes("No importable variants")
          ? "no_importable_variants"
          : message.includes("KickDB request failed (404)")
            ? "kickdb_404"
            : message.includes("suggestedRetailPriceInclVat")
              ? "db_missing_suggested_retail_column"
              : message.includes("Database error")
                ? "database_error"
                : "other";
    errorSummary[key] = (errorSummary[key] ?? 0) + 1;
    if (errorSamples.length < 8) {
      errorSamples.push({
        slug,
        error: message.slice(0, 500),
      });
    }
  };

  await Promise.all(
    claimed.map((row) =>
      limit(async () => {
        const slug = String(row.slug ?? row.input ?? "").trim();
        try {
          const result = await importStxProductByInput(String(row.input ?? row.slug));
          if (result.ok) {
            imported += 1;
            await finalizeSlugSync(row, true, null);
            return;
          }
          errored += 1;
          const detail = [
            ...(result.errors ?? []),
            ...(result.warnings?.length ? [`warnings: ${result.warnings.slice(0, 3).join(" | ")}`] : []),
          ]
            .join(" · ")
            .slice(0, 2000);
          recordError(slug, detail || "Import failed");
          await finalizeSlugSync(row, false, detail || "Import failed");
        } catch (error: any) {
          errored += 1;
          const message = error?.message ?? "Import failed";
          recordError(slug, message);
          await finalizeSlugSync(row, false, message);
        }
      })
    )
  );

  const counts = await getStxImportSlugCounts();
  return {
    claimed: claimed.length,
    imported,
    errored,
    releasedStaleLocks,
    durationMs: Date.now() - startedAt,
    counts,
    errorSamples,
    errorSummary,
  };
}
