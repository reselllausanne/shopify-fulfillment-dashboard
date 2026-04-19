import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body?.dryRun !== false;
    const confirm = body?.confirm === true || body?.confirm === "YES";
    const limit = Math.max(0, Number(body?.limit ?? 0));
    const supplierPrefix = typeof body?.supplierPrefix === "string" ? body.supplierPrefix.trim() : "";
    if (!dryRun && !confirm) {
      return NextResponse.json(
        { ok: false, error: "confirm=true is required for backfill" },
        { status: 400 }
      );
    }

    const where: any = {
      gtin: null,
      supplierVariant: { gtin: { not: null } },
    };
    if (supplierPrefix) {
      where.supplierVariant = {
        ...where.supplierVariant,
        supplierVariantId: { startsWith: supplierPrefix },
      };
    }

    const rows = await prisma.variantMapping.findMany({
      where,
      select: {
        id: true,
        supplierVariantId: true,
        status: true,
        supplierVariant: { select: { gtin: true } },
      },
      ...(limit > 0 ? { take: limit } : {}),
    });

    let invalidCount = 0;
    for (const row of rows) {
      const gtin = row.supplierVariant?.gtin ?? null;
      if (gtin && !buildProviderKey(gtin, row.supplierVariantId)) invalidCount += 1;
    }
    const sample = rows.slice(0, 25).map((row) => ({
      supplierVariantId: row.supplierVariantId,
      gtin: row.supplierVariant?.gtin ?? null,
    }));

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        count: rows.length,
        invalidCount,
        sample,
      });
    }

    let updated = 0;
    let skippedInvalid = 0;
    for (const row of rows) {
      const gtin = row.supplierVariant?.gtin ?? null;
      if (!gtin) continue;
      const providerKey = buildProviderKey(gtin, row.supplierVariantId);
      if (!providerKey) {
        skippedInvalid += 1;
        continue;
      }
      const nextStatus =
        row.status === null || row.status === "PENDING_GTIN" ? "SUPPLIER_GTIN" : row.status;
      await prisma.variantMapping.update({
        where: { id: row.id },
        data: {
          gtin,
          providerKey,
          status: nextStatus,
        },
      });
      updated += 1;
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      updated,
      skippedInvalid,
      sample,
    });
  } catch (error: any) {
    console.error("[GALAXUS][CLEANUP] backfill-mapping-gtin failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to backfill mapping gtin" },
      { status: 500 }
    );
  }
}

