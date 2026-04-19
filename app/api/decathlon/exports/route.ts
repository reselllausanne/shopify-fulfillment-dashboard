import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const prismaAny = prisma as any;
    const runs = await prismaAny.decathlonExportRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 20,
      include: { files: true },
    });

    const payload = runs.map((run: any) => ({
      runId: run.runId,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      success: Boolean(run.success),
      errorMessage: run.errorMessage ?? null,
      counts: run.countsJson ?? null,
      exclusions: run.exclusionsJson ? { totals: run.exclusionsJson.totals ?? null } : null,
      files: Array.isArray(run.files)
        ? run.files.map((file: any) => ({
            fileType: file.fileType,
            rowCount: file.rowCount,
            checksum: file.checksum ?? null,
            storageUrl: file.storageUrl ?? null,
            publicUrl: file.publicUrl ?? null,
            sizeBytes: file.sizeBytes ?? null,
          }))
        : [],
    }));

    return NextResponse.json({ ok: true, runs: payload });
  } catch (error: any) {
    console.error("[DECATHLON][EXPORT] List failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to list exports" },
      { status: 500 }
    );
  }
}
