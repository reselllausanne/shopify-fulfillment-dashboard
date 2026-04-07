import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";
import { createLimiter } from "@/galaxus/jobs/bulkSql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

const ENRICH_LOCK_KEY = 912347; // arbitrary, stable lock key

type EnrichStatus = {
  running: boolean;
  processed: number;
  remaining: number | null;
  lastError: string | null;
  lastRunAt: string | null;
  lastResults?: Array<{ supplierVariantId: string; status: string; gtin: string | null; error?: string | null }>;
};

async function tryAcquireLock() {
  const res = await prisma.$queryRaw<Array<{ locked: boolean }>>(
    Prisma.sql`SELECT pg_try_advisory_lock(${ENRICH_LOCK_KEY}) AS "locked"`
  );
  return Boolean(res?.[0]?.locked);
}

async function releaseLock() {
  await prisma.$queryRaw(Prisma.sql`SELECT pg_advisory_unlock(${ENRICH_LOCK_KEY})`);
}

async function countRemaining(supplierVariantIdPrefix?: string | null) {
  const prefixFilter = supplierVariantIdPrefix
    ? Prisma.sql`AND sv."supplierVariantId" ILIKE ${`${supplierVariantIdPrefix}%`}`
    : Prisma.sql``;
  const res = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS "count"
    FROM "public"."SupplierVariant" sv
    LEFT JOIN "public"."VariantMapping" vm
      ON vm."supplierVariantId" = sv."supplierVariantId"
    WHERE vm."supplierVariantId" IS NULL
       OR vm."gtin" IS NULL
       OR vm."status" IN ('PENDING_GTIN','AMBIGUOUS_GTIN')
    ${prefixFilter}
  `);
  return res?.[0]?.count ?? 0;
}

async function fetchNextBatch(batchSize: number, supplierVariantIdPrefix?: string | null) {
  const prefixFilter = supplierVariantIdPrefix
    ? Prisma.sql`AND sv."supplierVariantId" ILIKE ${`${supplierVariantIdPrefix}%`}`
    : Prisma.sql``;
  const res = await prisma.$queryRaw<Array<{ supplierVariantId: string }>>(Prisma.sql`
    SELECT sv."supplierVariantId"
    FROM "public"."SupplierVariant" sv
    LEFT JOIN "public"."VariantMapping" vm
      ON vm."supplierVariantId" = sv."supplierVariantId"
    WHERE vm."supplierVariantId" IS NULL
       OR vm."gtin" IS NULL
       OR vm."status" IN ('PENDING_GTIN','AMBIGUOUS_GTIN')
    ${prefixFilter}
    ORDER BY COALESCE(vm."updatedAt", sv."updatedAt") ASC
    LIMIT ${batchSize}
  `);
  return res.map((row) => row.supplierVariantId).filter(Boolean);
}

async function updateJob(
  jobId: string,
  payload: {
    processed: number;
    remaining: number | null;
    errors: number;
    lastError: string | null;
    running: boolean;
    lastResults?: Array<{ supplierVariantId: string; status: string; gtin: string | null; error?: string | null }>;
  }
) {
  await (prisma as any).galaxusJobRun.update({
    where: { id: jobId },
    data: {
      finishedAt: new Date(),
      success: payload.errors === 0 && payload.remaining === 0,
      errorMessage: payload.lastError ?? null,
      resultJson: payload,
    },
  });
}

async function runEnrichAll(
  jobId: string,
  forceMissing: boolean,
  supplierVariantIdPrefix?: string | null
) {
  // Larger batches and moderate parallelism reduce total wall time
  // while staying below aggressive external API pressure.
  const batchSize = 500;
  const kickdbConcurrency = 8;
  const dbConcurrency = 4;
  const kickdbLimit = createLimiter(kickdbConcurrency);
  const dbLimit = createLimiter(dbConcurrency);

  let processed = 0;
  let errors = 0;
  let lastError: string | null = null;
  let batchIndex = 0;
  const lastResults: Array<{ supplierVariantId: string; status: string; gtin: string | null; error?: string | null }> = [];

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await fetchNextBatch(batchSize, supplierVariantIdPrefix);
      if (batch.length === 0) break;

      const batchStatuses = await Promise.all(
        batch.map((supplierVariantId) =>
          kickdbLimit(() =>
            dbLimit(async () => {
              try {
                const { results } = await runKickdbEnrich({ supplierVariantId, forceMissing });
                const match = results.find((item) => item.supplierVariantId === supplierVariantId);
                const status = match?.status ?? "UNKNOWN";
                if (match) {
                  lastResults.push({
                    supplierVariantId,
                    status: match.status,
                    gtin: match.gtin ?? null,
                    error: match.error ?? null,
                  });
                  if (lastResults.length > 10) lastResults.shift();
                }
                processed += 1;
                return status;
              } catch (error: any) {
                errors += 1;
                lastError = error?.message ?? "Enrich failed";
                return "ERROR";
              }
            })
          )
        )
      );

      // Prevent infinite loops when all candidates are cache-skipped and remain pending.
      const hasActionableResult = batchStatuses.some((status) => !String(status).startsWith("SKIPPED"));
      if (!hasActionableResult) {
        lastError = "Stopped enrich-all: no actionable rows in batch (all cache-skipped).";
        break;
      }

      batchIndex += 1;
      if (batchIndex % 2 === 0) {
        const remaining = await countRemaining(supplierVariantIdPrefix);
        await updateJob(jobId, { processed, remaining, errors, lastError, running: true, lastResults });
      } else {
        await updateJob(jobId, { processed, remaining: null, errors, lastError, running: true, lastResults });
      }
    }
  } finally {
    const remaining = await countRemaining(supplierVariantIdPrefix);
    await updateJob(jobId, { processed, remaining, errors, lastError, running: false, lastResults });
    await releaseLock();
  }
}

export async function GET() {
  const lastRun = await (prisma as any).galaxusJobRun.findFirst({
    where: { jobName: "kickdb-enrich-all" },
    orderBy: { startedAt: "desc" },
  });
  const result = (lastRun?.resultJson ?? {}) as any;
  const status: EnrichStatus = {
    running: Boolean(result.running),
    processed: Number(result.processed ?? 0),
      remaining: result.remaining === null || result.remaining === undefined ? null : Number(result.remaining ?? 0),
    lastError: result.lastError ?? lastRun?.errorMessage ?? null,
    lastRunAt: lastRun?.startedAt ? new Date(lastRun.startedAt).toISOString() : null,
    lastResults: Array.isArray(result.lastResults) ? result.lastResults : undefined,
  };
  return NextResponse.json({ ok: true, status });
}

export async function POST(request: Request) {
  const acquired = await tryAcquireLock();
  if (!acquired) {
    return NextResponse.json({ ok: false, running: true, error: "Enrich already running" }, { status: 409 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const forceMissing = ["1", "true", "yes"].includes((searchParams.get("forceMissing") ?? "").toLowerCase());
    const supplierVariantIdPrefix = searchParams.get("supplierVariantIdPrefix")?.trim() || null;
    const startedAt = new Date();
    const remaining = await countRemaining(supplierVariantIdPrefix);
    const job = await (prisma as any).galaxusJobRun.create({
      data: {
        jobName: "kickdb-enrich-all",
        startedAt,
        finishedAt: startedAt,
        success: false,
        resultJson: {
          processed: 0,
          remaining,
          errors: 0,
          lastError: null,
          running: true,
          forceMissing,
          supplierVariantIdPrefix,
        },
      },
    });

    setTimeout(() => {
      void runEnrichAll(job.id, forceMissing, supplierVariantIdPrefix);
    }, 0);

    return NextResponse.json({
      ok: true,
      running: true,
      jobId: job.id,
      remaining,
      forceMissing,
      supplierVariantIdPrefix,
    });
  } catch (error: any) {
    await releaseLock();
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
