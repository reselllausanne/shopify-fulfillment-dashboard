import { NextRequest, NextResponse } from "next/server";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { getJob } from "@/galaxus/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const job = await getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = (job.payloadJson || {}) as { partnerId?: string };
  if (payload.partnerId && payload.partnerId !== session.partnerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    job: {
      id: job.id,
      jobType: job.jobType,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      createdAt: job.createdAt,
      result: job.resultJson ?? null,
      errorMessage: job.errorMessage ?? null,
    },
  });
}
