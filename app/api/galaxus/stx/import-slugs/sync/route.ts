import { NextResponse } from "next/server";
import { enqueueJob } from "@/galaxus/jobs/queue";
import { getStxImportSlugCounts } from "@/galaxus/stx/importSlugsBulk";
import { runStxImportSlugsSyncBatch } from "@/galaxus/stx/importSlugsSyncJob";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JOB_TYPE = "stx-import-slugs-sync";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const enqueue = body?.enqueue === true || body?.background === true;
    const all = Boolean(body?.all);
    const autoDrain = body?.autoDrain !== false;
    const workerJobs = Math.min(Math.max(Number(body?.workerJobs ?? body?.workers ?? 1), 1), 12);
    const concurrency = Math.min(Math.max(Number(body?.concurrency ?? 6), 1), 20);
    const batchSize = Math.min(Math.max(Number(body?.batchSize ?? 120), 1), 500);
    const limitRaw = Number(body?.limit ?? 50);
    const inlineLimit = all
      ? batchSize
      : Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 1000);

    if (enqueue) {
      const prismaAny = prisma as any;
      const alreadyRunning = await prismaAny.galaxusJobQueue.count({
        where: { jobType: JOB_TYPE, status: { in: ["PENDING", "RUNNING"] } },
      });
      if (alreadyRunning > 0) {
        const counts = await getStxImportSlugCounts();
        return NextResponse.json({
          ok: true,
          mode: "enqueue",
          skipped: true,
          message: "STX slug sync already queued or running.",
          runningJobs: alreadyRunning,
          counts,
        });
      }

      const jobs = [];
      for (let i = 0; i < workerJobs; i += 1) {
        jobs.push(
          await enqueueJob(
            JOB_TYPE,
            { batchSize, concurrency, autoDrain },
            { priority: 0, groupKey: "stx-import-slugs-sync", maxAttempts: 8 }
          )
        );
      }

      const counts = await getStxImportSlugCounts();
      return NextResponse.json({
        ok: true,
        mode: "enqueue",
        jobType: JOB_TYPE,
        jobsEnqueued: jobs.length,
        jobIds: jobs.map((job) => job.id),
        config: { batchSize, concurrency, autoDrain, workerJobs },
        counts,
        etaHint:
          counts.pending > 0
            ? `~${Math.ceil((counts.pending / Math.max(concurrency * workerJobs, 1)) * 3 / 3600)}h at ~3s/slug with ${workerJobs} job(s) × ${concurrency} parallel`
            : null,
      });
    }

    const result = await runStxImportSlugsSyncBatch({
      batchSize: inlineLimit,
      concurrency: Math.min(concurrency, inlineLimit),
      workerId: "api-inline",
    });

    return NextResponse.json({
      ok: true,
      mode: "inline",
      processed: result.claimed,
      imported: result.imported,
      errored: result.errored,
      counts: result.counts,
      durationMs: result.durationMs,
      errorSummary: result.errorSummary,
      errorSamples: result.errorSamples,
      hint:
        result.errored > 0 && (result.errorSummary.no_express_price ?? 0) > 0
          ? "Most failures: KickDB has no express_standard/express_expedited asks (only standard or empty). STX import requires express + asks≥2."
          : result.errorSummary.db_missing_suggested_retail_column
            ? "DB missing suggestedRetailPriceInclVat column — run migration in Supabase SQL editor."
            : null,
    });
  } catch (error: any) {
    console.error("[GALAXUS][STX][IMPORT-SLUGS][SYNC] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to sync STX slugs" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const prismaAny = prisma as any;
    const [counts, pendingJobs, runningJobs, recentJobs] = await Promise.all([
      getStxImportSlugCounts(),
      prismaAny.galaxusJobQueue.count({ where: { jobType: JOB_TYPE, status: "PENDING" } }),
      prismaAny.galaxusJobQueue.count({ where: { jobType: JOB_TYPE, status: "RUNNING" } }),
      prismaAny.galaxusJobQueue.findMany({
        where: { jobType: JOB_TYPE },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: {
          id: true,
          status: true,
          attempts: true,
          errorMessage: true,
          resultJson: true,
          updatedAt: true,
        },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      counts,
      queue: { pendingJobs, runningJobs, recentJobs },
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed to load sync status" }, { status: 500 });
  }
}
