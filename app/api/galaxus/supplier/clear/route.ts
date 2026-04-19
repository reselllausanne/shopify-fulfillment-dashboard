import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/galaxus/supplier/clear?confirm=YES
 *
 * Deletes supplier-synced data (SupplierVariant + VariantMapping).
 * Optional: includeKickdb=1 to also delete KickDB cache tables.
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const confirm = (searchParams.get("confirm") ?? "").trim().toUpperCase();
    const includeKickdb = ["1", "true", "yes"].includes((searchParams.get("includeKickdb") ?? "").toLowerCase());

    if (confirm !== "YES") {
      return NextResponse.json(
        {
          ok: false,
          error: "Refusing to delete without confirm=YES",
        },
        { status: 400 }
      );
    }

    const prismaAny = prisma as any;

    const counts = {
      supplierVariants: await prismaAny.supplierVariant.count(),
      variantMappings: await prismaAny.variantMapping.count(),
      kickdbVariants: includeKickdb ? await prismaAny.kickDBVariant.count() : 0,
      kickdbProducts: includeKickdb ? await prismaAny.kickDBProduct.count() : 0,
    };

    await prismaAny.$transaction(async (tx: any) => {
      // delete mappings first for clarity (supplierVariant also cascades, but this is explicit)
      await tx.variantMapping.deleteMany({});
      await tx.supplierVariant.deleteMany({});
      if (includeKickdb) {
        await tx.kickDBVariant.deleteMany({});
        await tx.kickDBProduct.deleteMany({});
      }
    });

    return NextResponse.json({ ok: true, deleted: counts, includeKickdb });
  } catch (error: any) {
    console.error("[GALAXUS][SUPPLIER][CLEAR] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

