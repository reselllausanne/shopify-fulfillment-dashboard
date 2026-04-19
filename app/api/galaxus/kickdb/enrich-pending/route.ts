import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";
import { createLimiter } from "@/galaxus/jobs/bulkSql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const prismaAny = prisma as any;
    const startedAt = new Date();
    const candidates = await prismaAny.variantMapping.findMany({
      where: { status: { in: ["PENDING_GTIN", "AMBIGUOUS_GTIN"] } },
      select: { supplierVariantId: true },
      orderBy: { updatedAt: "asc" },
    });
    const ids = candidates
      .map((row: any) => String(row.supplierVariantId ?? "").trim())
      .filter((id: string) => id.length > 0);
    const limiter = createLimiter(3);
    let processed = 0;
    let errors = 0;
    await Promise.all(
      ids.map((supplierVariantId: string) =>
        limiter(async () => {
          try {
            const { results } = await runKickdbEnrich({
              supplierVariantId,
              forceMissing: true,
            });
            processed += results.length;
          } catch {
            errors += 1;
          }
        })
      )
    );
    const payload = { ok: true, total: ids.length, processed, errors };
    await prismaAny.galaxusJobRun.create({
      data: {
        jobName: "kickdb-enrich-pending",
        startedAt,
        finishedAt: new Date(),
        success: true,
        resultJson: payload,
      },
    });
    return NextResponse.json(payload);
  } catch (error: any) {
    console.error("[GALAXUS][KICKDB][ENRICH-PENDING] Failed:", error);
    const prismaAny = prisma as any;
    await prismaAny.galaxusJobRun.create({
      data: {
        jobName: "kickdb-enrich-pending",
        startedAt: new Date(),
        finishedAt: new Date(),
        success: false,
        errorMessage: error?.message ?? "Failed to enrich pending rows",
      },
    });
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to enrich pending rows" },
      { status: 500 }
    );
  }
}
