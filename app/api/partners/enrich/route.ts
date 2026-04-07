import { NextRequest, NextResponse } from "next/server";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { enqueueJob } from "@/galaxus/jobs/queue";
import { runPartnerUploadEnrich } from "@/galaxus/partners/enrichUploadJob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await getPartnerSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const mode = (searchParams.get("mode") ?? "new").toLowerCase();
    const debug = searchParams.get("debug") === "1";
    const force = searchParams.get("force") === "1";
    const autoDrain = searchParams.get("autoDrain") === "1";
    const limit = Math.min(Number(searchParams.get("limit") ?? "500"), 2000);

    const partnerKey = normalizeProviderKey(session.partnerKey);
    if (!partnerKey) {
      return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
    }

    if (autoDrain) {
      const origin = new URL(request.url).origin;
      const job = await enqueueJob(
        "partner-upload-enrich",
        { partnerKey, limit, force, autoDrain: true, origin },
        { priority: 0, groupKey: partnerKey }
      );
      return NextResponse.json({
        ok: true,
        mode,
        queued: true,
        jobId: job.id,
        limit,
      });
    }

    const origin = new URL(request.url).origin;
    const result = await runPartnerUploadEnrich({
      partnerKey,
      limit,
      force,
      debug,
      origin,
    });

    return NextResponse.json({
      ok: true,
      mode,
      processed: result.processed,
      resolved: result.resolved,
      results: result.results,
    });
  } catch (error: any) {
    console.error("[PARTNER][KICKDB][ENRICH] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
