import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function countQuery(query: Prisma.Sql): Promise<number> {
  const res = await prisma.$queryRaw<Array<{ count: number }>>(query);
  return res?.[0]?.count ?? 0;
}

export async function GET() {
  try {
    const [
      supplierVariants,
      variantMappings,
      kickdbProducts,
      kickdbVariants,
      partnerVariants,
      partnerUploadRows,
      supplierVariantsWithoutMapping,
      mappingsWithoutSupplierVariant,
      mappingsWithoutKickdbVariant,
      kickdbProductsWithoutVariants,
      kickdbVariantsWithoutMappings,
      partnerVariantsWithoutMapping,
      partnerUploadRowsWithoutUpload,
      partnerUploadRowsWithoutPartner,
      orderRoutingIssuesWithoutOrder,
    ] = await Promise.all([
      prisma.supplierVariant.count(),
      prisma.variantMapping.count(),
      prisma.kickDBProduct.count(),
      prisma.kickDBVariant.count(),
      prisma.partnerVariant.count(),
      prisma.partnerUploadRow.count(),
      countQuery(Prisma.sql`
        SELECT COUNT(*)::int AS "count"
        FROM "public"."SupplierVariant" sv
        LEFT JOIN "public"."VariantMapping" vm
          ON vm."supplierVariantId" = sv."supplierVariantId"
        WHERE vm."supplierVariantId" IS NULL
      `),
      countQuery(Prisma.sql`
        SELECT COUNT(*)::int AS "count"
        FROM "public"."VariantMapping" vm
        LEFT JOIN "public"."SupplierVariant" sv
          ON sv."supplierVariantId" = vm."supplierVariantId"
        WHERE vm."supplierVariantId" IS NOT NULL
          AND sv."supplierVariantId" IS NULL
      `),
      countQuery(Prisma.sql`
        SELECT COUNT(*)::int AS "count"
        FROM "public"."VariantMapping" vm
        LEFT JOIN "public"."KickDBVariant" kv
          ON kv."id" = vm."kickdbVariantId"
        WHERE vm."kickdbVariantId" IS NOT NULL
          AND kv."id" IS NULL
      `),
      countQuery(Prisma.sql`
        SELECT COUNT(*)::int AS "count"
        FROM "public"."KickDBProduct" kp
        LEFT JOIN "public"."KickDBVariant" kv
          ON kv."productId" = kp."id"
        WHERE kv."id" IS NULL
      `),
      countQuery(Prisma.sql`
        SELECT COUNT(*)::int AS "count"
        FROM "public"."KickDBVariant" kv
        LEFT JOIN "public"."VariantMapping" vm
          ON vm."kickdbVariantId" = kv."id"
        WHERE vm."id" IS NULL
      `),
      countQuery(Prisma.sql`
        SELECT COUNT(*)::int AS "count"
        FROM "public"."PartnerVariant" pv
        LEFT JOIN "public"."VariantMapping" vm
          ON vm."partnerVariantId" = pv."id"
        WHERE vm."id" IS NULL
      `),
      countQuery(Prisma.sql`
        SELECT COUNT(*)::int AS "count"
        FROM "public"."PartnerUploadRow"
        WHERE "uploadId" IS NULL
      `),
      countQuery(Prisma.sql`
        SELECT COUNT(*)::int AS "count"
        FROM "public"."PartnerUploadRow"
        WHERE "partnerId" IS NULL
      `),
      countQuery(Prisma.sql`
        SELECT COUNT(*)::int AS "count"
        FROM "public"."OrderRoutingIssue"
        WHERE "orderId" IS NULL
      `),
    ]);

    return NextResponse.json({
      ok: true,
      totals: {
        supplierVariants,
        variantMappings,
        kickdbProducts,
        kickdbVariants,
        partnerVariants,
        partnerUploadRows,
      },
      cleanupCandidates: {
        supplierVariantsWithoutMapping,
        mappingsWithoutSupplierVariant,
        mappingsWithoutKickdbVariant,
        kickdbProductsWithoutVariants,
        kickdbVariantsWithoutMappings,
        partnerVariantsWithoutMapping,
        partnerUploadRowsWithoutUpload,
        partnerUploadRowsWithoutPartner,
        orderRoutingIssuesWithoutOrder,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load cleanup stats." },
      { status: 500 }
    );
  }
}
