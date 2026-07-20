import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { checkSharedSecret } from "@/app/api/kickdb/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/inventory/locations?stockedOnly=true&limit=500
 *
 * Read the per-location physical stock mirror. Visibility endpoint for the
 * dashboard / debugging. Also returns a per-location summary.
 */
export async function GET(req: Request) {
  const authError = checkSharedSecret(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const stockedOnly = searchParams.get("stockedOnly") !== "false";
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 500), 1), 5000);

  try {
    const summary = await prisma.$queryRaw<
      Array<{ locationName: string; sourceType: string; skus: bigint; units: bigint }>
    >`
      SELECT "locationName", "sourceType",
             count(*) FILTER (WHERE "available" > 0) AS skus,
             COALESCE(sum("available") FILTER (WHERE "available" > 0), 0) AS units
      FROM "public"."ShopifyVariantLocationStock"
      GROUP BY "locationName", "sourceType"
      ORDER BY min("priority")
    `;

    const rows = stockedOnly
      ? await prisma.$queryRaw`
          SELECT "shopifyVariantId", "sku", "gtin", "locationName", "sourceType", "priority", "available", "updatedAt"
          FROM "public"."ShopifyVariantLocationStock"
          WHERE "available" > 0
          ORDER BY "priority" ASC, "sku" ASC
          LIMIT ${limit}
        `
      : await prisma.$queryRaw`
          SELECT "shopifyVariantId", "sku", "gtin", "locationName", "sourceType", "priority", "available", "updatedAt"
          FROM "public"."ShopifyVariantLocationStock"
          ORDER BY "priority" ASC, "sku" ASC
          LIMIT ${limit}
        `;

    return NextResponse.json({
      ok: true,
      summary: summary.map((s) => ({
        locationName: s.locationName,
        sourceType: s.sourceType,
        skus: Number(s.skus),
        units: Number(s.units),
      })),
      rows,
    });
  } catch (e: any) {
    console.error("[inventory/locations] error", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "query_failed" }, { status: 500 });
  }
}
