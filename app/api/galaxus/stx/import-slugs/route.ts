import { NextResponse } from "next/server";
import {
  bulkInsertStxImportSlugs,
  dedupeSlugRows,
  getStxImportSlugCounts,
} from "@/galaxus/stx/importSlugsBulk";
import { listStxImportSlugsForAsksThresholdRetry } from "@/galaxus/stx/importSlugRetry";
import { toCsv } from "@/galaxus/exports/csv";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function extractLines(input: string): string[] {
  return input
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => Boolean(line));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const download = searchParams.get("download") === "1";
    const downloadRetry = searchParams.get("download") === "asks-threshold-retry";
    if (downloadRetry) {
      const rows = await listStxImportSlugsForAsksThresholdRetry(50_000);
      const headers = ["slug", "input", "lastError"];
      const csvRows = rows.map((row) => ({
        slug: row.slug,
        input: row.input,
        lastError: row.lastError ?? "",
      }));
      const csv = toCsv(headers, csvRows);
      const filename = `stx-asks-threshold-retry-${Date.now()}.csv`;
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "X-Total-Rows": rows.length.toString(),
        },
      });
    }
    if (download) {
      const prismaAny = prisma as any;
      const rows = await prismaAny.stxImportSlug.findMany({
        orderBy: { createdAt: "asc" },
      });
      const headers = ["slug", "input", "status", "createdAt", "importedAt", "lastError"];
      const csvRows = rows.map((row: any) => ({
        slug: row.slug,
        input: row.input,
        status: row.status,
        createdAt: row.createdAt?.toISOString?.() ?? "",
        importedAt: row.importedAt?.toISOString?.() ?? "",
        lastError: row.lastError ?? "",
      }));
      const csv = toCsv(headers, csvRows);
      const filename = `stx-import-slugs-${Date.now()}.csv`;
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "X-Total-Rows": rows.length.toString(),
        },
      });
    }
    const counts = await getStxImportSlugCounts();
    return NextResponse.json({ ok: true, counts });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load slug counts" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const raw = typeof body?.input === "string" ? body.input : "";
    const lines = extractLines(raw);
    if (lines.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Provide at least one slug or URL." },
        { status: 400 }
      );
    }

    const rows = dedupeSlugRows(lines);
    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid slugs/URLs found." },
        { status: 400 }
      );
    }

    const insertedNew = await bulkInsertStxImportSlugs(rows);
    const counts = await getStxImportSlugCounts();

    return NextResponse.json({
      ok: true,
      counts,
      stats: {
        linesReceived: lines.length,
        uniqueSlugs: rows.length,
        duplicateLinesInPaste: Math.max(0, lines.length - rows.length),
        insertedNew,
        skippedExisting: Math.max(0, rows.length - insertedNew),
      },
    });
  } catch (error: any) {
    console.error("[GALAXUS][STX][IMPORT-SLUGS] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to save slugs" },
      { status: 500 }
    );
  }
}
