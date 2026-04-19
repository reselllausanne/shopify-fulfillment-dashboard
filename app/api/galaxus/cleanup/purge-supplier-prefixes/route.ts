import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawPrefixes = Array.isArray(body?.prefixes) ? body.prefixes : ["trm", "gld"];
    const prefixes = rawPrefixes
      .map((value: any) => String(value ?? "").trim().toLowerCase())
      .filter(Boolean);
    const confirm = body?.confirm === true || body?.confirm === "YES";
    const dryRun = body?.dryRun !== false;
    if (prefixes.length === 0) {
      return NextResponse.json({ ok: false, error: "prefixes are required" }, { status: 400 });
    }
    if (!dryRun && !confirm) {
      return NextResponse.json(
        { ok: false, error: "confirm=true is required for destructive purge" },
        { status: 400 }
      );
    }

    const supplierVariantFilters = prefixes.flatMap((prefix: string) => [
      { supplierVariantId: { startsWith: `${prefix}:`, mode: "insensitive" } },
      { supplierVariantId: { startsWith: `${prefix}_`, mode: "insensitive" } },
      { providerKey: { startsWith: `${prefix.toUpperCase()}_` } },
    ]);
    const mappingFilters = prefixes.flatMap((prefix: string) => [
      { supplierVariantId: { startsWith: `${prefix}:`, mode: "insensitive" } },
      { supplierVariantId: { startsWith: `${prefix}_`, mode: "insensitive" } },
      { providerKey: { startsWith: `${prefix.toUpperCase()}_` } },
    ]);

    const sample = await prisma.supplierVariant.findMany({
      where: { OR: supplierVariantFilters },
      select: { supplierVariantId: true },
      take: 25,
    });
    const total = await prisma.supplierVariant.count({ where: { OR: supplierVariantFilters } });

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        prefixes,
        total,
        sample: sample.map((row) => row.supplierVariantId),
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const mappingsDeleted = await tx.variantMapping.deleteMany({ where: { OR: mappingFilters } });
      const variantsDeleted = await tx.supplierVariant.deleteMany({ where: { OR: supplierVariantFilters } });
      return { mappingsDeleted: mappingsDeleted.count, variantsDeleted: variantsDeleted.count };
    });

    return NextResponse.json({
      ok: true,
      dryRun: false,
      prefixes,
      ...result,
    });
  } catch (error: any) {
    console.error("[GALAXUS][CLEANUP] purge-supplier-prefixes failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to purge supplier prefixes" },
      { status: 500 }
    );
  }
}

