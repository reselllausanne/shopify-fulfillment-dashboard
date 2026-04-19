import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { importStxProductByInput } from "@/galaxus/stx/importProduct";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const limitRaw = Number(body?.limit ?? 50);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 1000);
    const prismaAny = prisma as any;

    const pending = await prismaAny.stxImportSlug.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    let imported = 0;
    let errored = 0;
    const errors: Array<{ slug: string; error: string }> = [];

    for (const row of pending) {
      try {
        const result = await importStxProductByInput(String(row.input ?? row.slug));
        if (result.ok) {
          imported += 1;
          await prismaAny.stxImportSlug.update({
            where: { slug: row.slug },
            data: { status: "IMPORTED", importedAt: new Date(), lastError: null },
          });
        } else {
          const message = result.errors?.[0] ?? "Import failed";
          errored += 1;
          errors.push({ slug: row.slug, error: message });
          await prismaAny.stxImportSlug.update({
            where: { slug: row.slug },
            data: { status: "ERROR", lastError: message },
          });
        }
      } catch (error: any) {
        const message = error?.message ?? "Import failed";
        errored += 1;
        errors.push({ slug: row.slug, error: message });
        await prismaAny.stxImportSlug.update({
          where: { slug: row.slug },
          data: { status: "ERROR", lastError: message },
        });
      }
    }

    const [pendingCount, importedCount, errorCount] = await Promise.all([
      prismaAny.stxImportSlug.count({ where: { status: "PENDING" } }),
      prismaAny.stxImportSlug.count({ where: { status: "IMPORTED" } }),
      prismaAny.stxImportSlug.count({ where: { status: "ERROR" } }),
    ]);

    return NextResponse.json({
      ok: true,
      processed: pending.length,
      imported,
      errored,
      errors: errors.slice(0, 20),
      counts: {
        pending: pendingCount,
        imported: importedCount,
        error: errorCount,
      },
    });
  } catch (error: any) {
    console.error("[GALAXUS][STX][IMPORT-SLUGS][SYNC] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to sync STX slugs" },
      { status: 500 }
    );
  }
}
