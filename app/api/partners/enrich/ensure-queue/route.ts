import { NextRequest, NextResponse } from "next/server";
import { resolveAppOriginForPartnerJobs } from "@/app/lib/partnerJobOrigin";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { enqueueJob } from "@/galaxus/jobs/queue";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * If this partner has PENDING_ENRICH rows but no active partner-upload-enrich job, enqueue batch job(s).
 * Safe to call repeatedly (e.g. from dashboard when backlog is visible).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getPartnerSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const partnerKey = normalizeProviderKey(session.partnerKey);
    if (!partnerKey) {
      return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
    }

    const prismaAny = prisma as any;
    const pendingEnrichTotal = await prismaAny.partnerUploadRow.count({
      where: { providerKey: partnerKey, status: "PENDING_ENRICH" },
    });
    if (pendingEnrichTotal <= 0) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "no_pending",
        pendingEnrichTotal: 0,
      });
    }

    const activeJobs = await prismaAny.galaxusJobQueue.count({
      where: {
        jobType: "partner-upload-enrich",
        groupKey: partnerKey,
        status: { in: ["PENDING", "RUNNING"] },
      },
    });
    if (activeJobs > 0) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "queue_active",
        activeJobs,
        pendingEnrichTotal,
      });
    }

    const batchLimit = 2000;
    const jobCount = Math.ceil(pendingEnrichTotal / batchLimit);
    const origin = resolveAppOriginForPartnerJobs(new URL(request.url).origin);
    const jobIds: string[] = [];
    for (let j = 0; j < jobCount; j++) {
      const job = await enqueueJob(
        "partner-upload-enrich",
        { partnerKey, limit: batchLimit, force: false, origin },
        { priority: 0, groupKey: partnerKey }
      );
      jobIds.push(job.id);
    }

    return NextResponse.json({
      ok: true,
      queued: jobCount,
      jobIds,
      pendingEnrichTotal,
    });
  } catch (error: any) {
    console.error("[PARTNER][ENRICH][ENSURE-QUEUE]", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "ensure-queue failed" },
      { status: 500 }
    );
  }
}
