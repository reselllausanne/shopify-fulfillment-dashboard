import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";
import { createLimiter } from "@/galaxus/jobs/bulkSql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const startedAt = Date.now();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "200"), 1), 200);
    const concurrency = Math.min(Math.max(Number(searchParams.get("concurrency") ?? "3"), 1), 5);

    const candidates = await prisma.$queryRaw<Array<{ supplierVariantId: string; createdAt: Date }>>(
      Prisma.sql`
        SELECT sv."supplierVariantId", sv."createdAt"
        FROM "public"."SupplierVariant" sv
        LEFT JOIN "public"."VariantMapping" vm
          ON vm."supplierVariantId" = sv."supplierVariantId"
        WHERE vm."supplierVariantId" IS NULL
           OR vm."gtin" IS NULL
           OR vm."status" IN ('PENDING_GTIN','AMBIGUOUS_GTIN','NOT_FOUND')
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
      durationMs,
    });

    return NextResponse.json({
      ok: true,
      limit,
      concurrency,
      processed,
      enrichedRows,
      enrichErrors,
      durationMs,
    });
  } catch (error: any) {
    console.error("[GALAXUS][KICKDB][ENRICH_MISSING] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

