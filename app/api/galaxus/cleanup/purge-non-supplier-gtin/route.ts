import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body?.dryRun !== false;
    const deleteAllNonStx = body?.deleteAllNonStx === true;
    const deletePrefixes = Array.isArray(body?.deletePrefixes) ? body.deletePrefixes : null;

    const rows = deletePrefixes
      ? await prisma.supplierVariant.findMany({
          where: {
            OR: deletePrefixes.map((prefix: string) => ({
              supplierVariantId: { startsWith: `${prefix}:` },
            })),
          },
          select: { supplierVariantId: true },
        })
      : deleteAllNonStx
        ? await prisma.$queryRaw<Array<{ supplierVariantId: string }>>(Prisma.sql`
            SELECT sv."supplierVariantId"
            FROM "public"."SupplierVariant" sv
            WHERE sv."supplierVariantId" NOT LIKE 'stx_%'
          `)
        : await prisma.$queryRaw<Array<{ supplierVariantId: string }>>(Prisma.sql`
            SELECT sv."supplierVariantId"
            FROM "public"."SupplierVariant" sv
            INNER JOIN "public"."VariantMapping" vm
              ON vm."supplierVariantId" = sv."supplierVariantId"
            WHERE sv."supplierVariantId" NOT LIKE 'stx_%'
              AND vm."kickdbVariantId" IS NOT NULL
              AND COALESCE(vm."status", '') <> 'SUPPLIER_GTIN'
          `);

    const supplierVariantIds = rows.map((row) => row.supplierVariantId);
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        count: supplierVariantIds.length,
        sample: supplierVariantIds.slice(0, 25),
        deleteAllNonStx,
        deletePrefixes: deletePrefixes ?? undefined,
      });
    }

    const deleted = await prisma.supplierVariant.deleteMany({
      where: { supplierVariantId: { in: supplierVariantIds } },
    });

    return NextResponse.json({
      ok: true,
      dryRun: false,
      deleted: deleted.count,
      deleteAllNonStx,
      deletePrefixes: deletePrefixes ?? undefined,
    });
  } catch (error: any) {
    console.error("[GALAXUS][CLEANUP] purge-non-supplier-gtin failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to purge supplier variants" },
      { status: 500 }
    );
  }
}
