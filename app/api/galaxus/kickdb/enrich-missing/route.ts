import { NextResponse } from "next/server";
import { enqueueJob } from "@/galaxus/jobs/queue";
import { runJob } from "@/galaxus/jobs/jobRunner";
import { runKickdbEnrichMissing } from "@/galaxus/kickdb/enrichMissingJob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "500"), 1), 5000);
    const concurrency = Math.min(Math.max(Number(searchParams.get("concurrency") ?? "8"), 1), 20);
    const force = ["1", "true", "yes"].includes((searchParams.get("force") ?? "").toLowerCase());
    const supplierVariantIdPrefix = searchParams.get("supplierVariantIdPrefix")?.trim() || null;
    const asyncMode = !["0", "false", "no"].includes((searchParams.get("async") ?? "").toLowerCase());
    // Default off: one queued job runs one batch unless autoDrain=1 (avoids endless NOT_FOUND loops).
    const autoDrain = ["1", "true", "yes"].includes((searchParams.get("autoDrain") ?? "").toLowerCase());

    if (asyncMode) {
      const job = await enqueueJob(
        "kickdb-enrich-missing",
        {
          limit,
          concurrency,
          force,
          supplierVariantIdPrefix,
          includeNotFound: true,
          respectRecentRun: true,
          autoDrain,
        },
        { priority: 0 }
      );
      return NextResponse.json({ ok: true, queued: true, jobId: job.id, limit, concurrency });
    }

    const job = await runJob("kickdb-enrich-missing", async () =>
      runKickdbEnrichMissing({
        limit,
        concurrency,
        force,
        supplierVariantIdPrefix,
        includeNotFound: true,
        respectRecentRun: true,
      })
    );

    return NextResponse.json({ ok: true, ...(job?.result ?? {}) });
  } catch (error: any) {
    console.error("[GALAXUS][KICKDB][ENRICH_MISSING] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

