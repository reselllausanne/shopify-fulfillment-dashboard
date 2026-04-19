import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getStorageAdapterForUrl } from "@/galaxus/storage/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId")?.trim();
    if (!runId) {
      return NextResponse.json({ ok: false, error: "Missing runId" }, { status: 400 });
    }
    const prismaAny = prisma as any;
    const run = await prismaAny.decathlonImportRun.findUnique({
      where: { runId },
    });
    if (!run?.errorStorageUrl) {
      return NextResponse.json({ ok: false, error: "Error report not found" }, { status: 404 });
    }
    const storage = getStorageAdapterForUrl(run.errorStorageUrl);
    const blob = await storage.getPdf(run.errorStorageUrl);
    const filename = `decathlon-error-report-${runId}.csv`;
    return new Response(blob.content as unknown as BodyInit, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": String(blob.content.length ?? 0),
      },
    });
  } catch (error: any) {
    console.error("[DECATHLON][OPS][ERROR-REPORT] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Download failed" },
      { status: 500 }
    );
  }
}
