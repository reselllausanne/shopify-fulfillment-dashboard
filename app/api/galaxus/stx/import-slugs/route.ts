import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { normalizeStxImportInput } from "@/galaxus/stx/importProduct";
import { toCsv } from "@/galaxus/exports/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractLines(input: string): string[] {
  return input
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => Boolean(line));
}

async function getCounts() {
  const prismaAny = prisma as any;
  const [pending, imported, error] = await Promise.all([
    prismaAny.stxImportSlug.count({ where: { status: "PENDING" } }),
    prismaAny.stxImportSlug.count({ where: { status: "IMPORTED" } }),
    prismaAny.stxImportSlug.count({ where: { status: "ERROR" } }),
  ]);
  return { pending, imported, error };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const download = searchParams.get("download") === "1";
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
    const counts = await getCounts();
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

    const normalized = lines
      .map((line) => ({ input: line, slug: normalizeStxImportInput(line) }))
      .filter((row) => Boolean(row.slug));

    if (normalized.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid slugs/URLs found." },
        { status: 400 }
      );
    }

    const prismaAny = prisma as any;
    for (const row of normalized) {
      await prismaAny.stxImportSlug.upsert({
        where: { slug: row.slug },
        create: {
          input: row.input,
          slug: row.slug,
          status: "PENDING",
        },
        update: {},
      });
    }

    const counts = await getCounts();
    return NextResponse.json({ ok: true, counts, inserted: normalized.length });
  } catch (error: any) {
    console.error("[GALAXUS][STX][IMPORT-SLUGS] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to save slugs" },
      { status: 500 }
    );
  }
}
