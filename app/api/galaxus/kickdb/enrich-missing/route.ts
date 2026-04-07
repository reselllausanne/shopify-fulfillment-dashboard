import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";
import { createLimiter } from "@/galaxus/jobs/bulkSql";
import { runJob } from "@/galaxus/jobs/jobRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "200"), 1), 2000);
    const concurrency = Math.min(Math.max(Number(searchParams.get("concurrency") ?? "3"), 1), 5);
    const force = ["1", "true", "yes"].includes((searchParams.get("force") ?? "").toLowerCase());
    const supplierVariantIdPrefix = searchParams.get("supplierVariantIdPrefix")?.trim() || null;

    const lastRun = await (prisma as any).galaxusJobRun.findFirst({
      where: { jobName: "kickdb-enrich-missing", success: true },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    });
    const fourDaysMs = 4 * 24 * 60 * 60 * 1000;
    const lastMs = lastRun?.startedAt ? new Date(lastRun.startedAt).getTime() : null;
    const recentRun = Boolean(lastMs && Date.now() - lastMs < fourDaysMs);
    const newCutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const job = await runJob("kickdb-enrich-missing", async () => {
      const startedAt = Date.now();
      const prefixFilter = supplierVariantIdPrefix
        ? Prisma.sql`AND sv."supplierVariantId" ILIKE ${`${supplierVariantIdPrefix}%`}`
        : Prisma.sql``;
      const candidates = await prisma.$queryRaw<Array<{ supplierVariantId: string; createdAt: Date }>>(
        Prisma.sql`
        SELECT sv."supplierVariantId", sv."createdAt"
        FROM "public"."SupplierVariant" sv
        LEFT JOIN "public"."VariantMapping" vm
          ON vm."supplierVariantId" = sv."supplierVariantId"
        WHERE vm."supplierVariantId" IS NULL
           OR vm."gtin" IS NULL
           OR vm."status" IN ('PENDING_GTIN','AMBIGUOUS_GTIN','NOT_FOUND')
          ${prefixFilter}
          ${recentRun && !force ? Prisma.sql`AND sv."createdAt" >= ${newCutoff}` : Prisma.sql``}
        ORDER BY sv."createdAt" DESC, sv."updatedAt" DESC
        LIMIT ${limit}
      `
      );

      let processed = 0;
      let enrichedRows = 0;
      let enrichErrors = 0;

      const enrichLimit = createLimiter(concurrency);
      const tasks = candidates.map((c) =>
        enrichLimit(async () => {
          processed += 1;
          try {
            const isNew = c.createdAt && Date.now() - new Date(c.createdAt).getTime() < 2 * 24 * 60 * 60 * 1000;
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
      console.info("[galaxus][kickdb][enrich-missing] done", {
        limit,
        concurrency,
        candidates: candidates.length,
        processed,
        enrichedRows,
        enrichErrors,
        recentRun,
        supplierVariantIdPrefix,
        durationMs,
      });

      return {
        limit,
        concurrency,
        processed,
        enrichedRows,
        enrichErrors,
        recentRun,
        supplierVariantIdPrefix,
        durationMs,
      };
    });

    return NextResponse.json({
      ok: true,
      ...(job?.result ?? {}),
    });
  } catch (error: any) {
    console.error("[GALAXUS][KICKDB][ENRICH_MISSING] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

