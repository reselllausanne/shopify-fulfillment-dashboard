import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";
import { createLimiter } from "@/galaxus/jobs/bulkSql";

export type EnrichMissingOptions = {
  limit?: number;
  concurrency?: number;
  force?: boolean;
  supplierVariantIdPrefix?: string | null;
  includeNotFound?: boolean;
  respectRecentRun?: boolean;
};

export async function runKickdbEnrichMissing(options: EnrichMissingOptions) {
  const startedAt = Date.now();
  const limit = Math.min(Math.max(Number(options.limit ?? 200), 1), 5000);
  const concurrency = Math.min(Math.max(Number(options.concurrency ?? 5), 1), 20);
  const force = Boolean(options.force);
  const includeNotFound = options.includeNotFound !== false;
  const supplierVariantIdPrefix = options.supplierVariantIdPrefix?.trim() || null;
  const respectRecentRun = options.respectRecentRun !== false;

  const lastRun = respectRecentRun
    ? await (prisma as any).galaxusJobRun.findFirst({
        where: { jobName: "kickdb-enrich-missing", success: true },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true },
      })
    : null;
  const fourDaysMs = 4 * 24 * 60 * 60 * 1000;
  const lastMs = lastRun?.startedAt ? new Date(lastRun.startedAt).getTime() : null;
  const recentRun = Boolean(lastMs && Date.now() - lastMs < fourDaysMs);
  const newCutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

  const prefixFilter = supplierVariantIdPrefix
    ? Prisma.sql`AND sv."supplierVariantId" ILIKE ${`${supplierVariantIdPrefix}%`}`
    : Prisma.sql``;
  const statusFilter = includeNotFound
    ? Prisma.sql`(vm."supplierVariantId" IS NULL OR vm."gtin" IS NULL OR vm."status" IN ('PENDING_GTIN','AMBIGUOUS_GTIN','NOT_FOUND'))`
    : Prisma.sql`(vm."supplierVariantId" IS NULL OR vm."gtin" IS NULL OR vm."status" IN ('PENDING_GTIN','AMBIGUOUS_GTIN'))`;

  const candidates = await prisma.$queryRaw<Array<{ supplierVariantId: string; createdAt: Date }>>(
    Prisma.sql`
      SELECT sv."supplierVariantId", sv."createdAt"
      FROM "public"."SupplierVariant" sv
      LEFT JOIN "public"."VariantMapping" vm
        ON vm."supplierVariantId" = sv."supplierVariantId"
      WHERE ${statusFilter}
        ${prefixFilter}
        ${recentRun && !force ? Prisma.sql`AND sv."createdAt" >= ${newCutoff}` : Prisma.sql``}
      ORDER BY sv."createdAt" DESC, sv."updatedAt" DESC
      LIMIT ${limit}
    `
  );
  const candidateCount = candidates.length;

  let processed = 0;
  let enrichedRows = 0;
  let enrichErrors = 0;

  const enrichLimit = createLimiter(concurrency);
  const tasks = candidates.map((c) =>
    enrichLimit(async () => {
      processed += 1;
      try {
        const isNew =
          c.createdAt && Date.now() - new Date(c.createdAt).getTime() < 2 * 24 * 60 * 60 * 1000;
        const { results } = await runKickdbEnrich({
          supplierVariantId: c.supplierVariantId,
          force: Boolean(isNew),
        });
        enrichedRows += results.length;
      } catch {
        enrichErrors += 1;
      }
    })
  );

  await Promise.all(tasks);

  const durationMs = Date.now() - startedAt;
  return {
    limit,
    concurrency,
    candidates: candidateCount,
    processed,
    enrichedRows,
    enrichErrors,
    recentRun,
    supplierVariantIdPrefix,
    durationMs,
  };
}
