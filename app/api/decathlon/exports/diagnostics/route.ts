import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId")?.trim();
    const prismaAny = prisma as any;
    const run = runId
      ? await prismaAny.decathlonExportRun.findUnique({ where: { runId } })
      : await prismaAny.decathlonExportRun.findFirst({ orderBy: { startedAt: "desc" } });

    if (!run) {
      return NextResponse.json({ ok: false, error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      runId: run.runId,
      success: Boolean(run.success),
      errorMessage: run.errorMessage ?? null,
      counts: run.countsJson ?? null,
      exclusions: run.exclusionsJson ?? null,
    });
  } catch (error: any) {
    console.error("[DECATHLON][EXPORT] Diagnostics failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Diagnostics failed" },
      { status: 500 }
    );
  }
}
