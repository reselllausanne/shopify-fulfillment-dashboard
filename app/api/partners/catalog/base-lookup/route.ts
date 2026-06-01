import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { validateGtin } from "@/app/lib/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only base product lookup for partners building offers on existing DB products.
 * Returns shareable metadata (name, brand, gender, colorway, gtin, image) aggregated by GTIN
 * so the UI can prefill a new partner-owned variant without exposing pricing/stock.
 */
export async function GET(req: NextRequest) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const gtin = (searchParams.get("gtin") ?? "").trim();
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "20"), 1), 100);

  const where: Prisma.SupplierVariantWhereInput = { gtin: { not: null } };
  if (gtin && validateGtin(gtin)) {
    where.gtin = gtin;
  } else if (q) {
    where.OR = [
      { gtin: { contains: q, mode: "insensitive" } },
      { supplierSku: { contains: q, mode: "insensitive" } },
      { supplierProductName: { contains: q, mode: "insensitive" } },
      { supplierBrand: { contains: q, mode: "insensitive" } },
    ];
  } else {
    return NextResponse.json({ ok: true, items: [] });
  }

  const rows = await prisma.supplierVariant.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: limit * 4,
    select: {
      supplierVariantId: true,
      gtin: true,
      supplierSku: true,
      supplierBrand: true,
      supplierProductName: true,
      supplierGender: true,
      supplierColorway: true,
      hostedImageUrl: true,
      sourceImageUrl: true,
      images: true,
      sizeRaw: true,
      sizeNormalized: true,
      weightGrams: true,
    },
  });

  // Dedupe by GTIN, keep first non-empty fields.
  const byGtin = new Map<string, any>();
  for (const r of rows) {
    const g = String(r.gtin ?? "").trim();
    if (!g) continue;
    const prev = byGtin.get(g);
    if (!prev) {
      byGtin.set(g, {
        gtin: g,
        supplierSku: r.supplierSku ?? null,
        supplierBrand: r.supplierBrand ?? null,
        supplierProductName: r.supplierProductName ?? null,
        supplierGender: r.supplierGender ?? null,
        supplierColorway: r.supplierColorway ?? null,
        hostedImageUrl: r.hostedImageUrl ?? null,
        sourceImageUrl: r.sourceImageUrl ?? null,
        images: r.images ?? null,
        sizeRaw: r.sizeRaw ?? null,
        sizeNormalized: r.sizeNormalized ?? null,
        weightGrams: r.weightGrams ?? null,
        sampleSupplierVariantId: r.supplierVariantId,
      });
      continue;
    }
    prev.supplierBrand ??= r.supplierBrand ?? null;
    prev.supplierProductName ??= r.supplierProductName ?? null;
    prev.supplierGender ??= r.supplierGender ?? null;
    prev.supplierColorway ??= r.supplierColorway ?? null;
    prev.hostedImageUrl ??= r.hostedImageUrl ?? null;
    prev.sourceImageUrl ??= r.sourceImageUrl ?? null;
    prev.images ??= r.images ?? null;
    prev.weightGrams ??= r.weightGrams ?? null;
  }

  const items = Array.from(byGtin.values()).slice(0, limit);
  return NextResponse.json({ ok: true, items });
}
