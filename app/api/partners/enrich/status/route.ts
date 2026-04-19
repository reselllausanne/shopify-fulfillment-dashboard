import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getPartnerSession(request);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const partnerKey = normalizeProviderKey(session.partnerKey);
    if (!partnerKey) {
      return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const reset = ["1", "true", "yes"].includes((searchParams.get("reset") ?? "").toLowerCase());
    const staleMinutesRaw = Number.parseInt(searchParams.get("staleMinutes") ?? "30", 10);
    const staleMinutes = Number.isFinite(staleMinutesRaw)
      ? Math.min(Math.max(staleMinutesRaw, 1), 1440)
      : 30;
    const staleCutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

    const prismaAny = prisma as any;
    const baseWhere = { jobType: "partner-upload-enrich", groupKey: partnerKey };

    const [pendingCount, runningCount, failedCount, completedCount, recentJobs, stuckJobs] =
      await Promise.all([
        prismaAny.galaxusJobQueue.count({ where: { ...baseWhere, status: "PENDING" } }),
        prismaAny.galaxusJobQueue.count({ where: { ...baseWhere, status: "RUNNING" } }),
        prismaAny.galaxusJobQueue.count({ where: { ...baseWhere, status: "FAILED" } }),
        prismaAny.galaxusJobQueue.count({ where: { ...baseWhere, status: "COMPLETED" } }),
        prismaAny.galaxusJobQueue.findMany({
          where: baseWhere,
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            status: true,
            attempts: true,
            maxAttempts: true,
            createdAt: true,
            updatedAt: true,
            lockedAt: true,
            lockedBy: true,
            errorMessage: true,
          },
        }),
        prismaAny.galaxusJobQueue.findMany({
          where: { ...baseWhere, status: "RUNNING", lockedAt: { lt: staleCutoff } },
          orderBy: { lockedAt: "asc" },
          take: 20,
          select: {
            id: true,
            lockedAt: true,
            lockedBy: true,
            attempts: true,
            errorMessage: true,
            createdAt: true,
          },
        }),
      ]);

    let resetCount = 0;
    if (reset && stuckJobs.length > 0) {
      const res = await prismaAny.galaxusJobQueue.updateMany({
        where: { id: { in: stuckJobs.map((job: any) => job.id) } },
        data: {
          status: "PENDING",
          lockedAt: null,
          lockedBy: null,
          updatedAt: new Date(),
        },
      });
      resetCount = res?.count ?? 0;
    }

    const pendingEnrichCount = await prismaAny.partnerUploadRow.count({
      where: { providerKey: partnerKey, status: "PENDING_ENRICH" },
    });
    const pendingGtinCount = await prismaAny.partnerUploadRow.count({
      where: { providerKey: partnerKey, status: { in: ["PENDING_GTIN", "AMBIGUOUS_GTIN"] } },
    });

    return NextResponse.json({
      ok: true,
      partnerKey,
      staleMinutes,
      counts: {
        pending: pendingCount,
        running: runningCount,
        failed: failedCount,
        completed: completedCount,
        pendingEnrichRows: pendingEnrichCount,
        pendingGtinRows: pendingGtinCount,
      },
      stuck: {
        cutoff: staleCutoff.toISOString(),
        count: stuckJobs.length,
        jobs: stuckJobs,
        resetCount,
      },
      recentJobs,
    });
  } catch (error: any) {
    console.error("[PARTNER][ENRICH][STATUS] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Status failed" },
      { status: 500 }
    );
  }
}
