import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CSV_HEADERS = [
  "providerKey",
  "supplierSku",
  "sizeRaw",
  "stock",
  "price",
  "gtin",
  "mappingStatus",
  "kickdbName",
  "kickdbBrand",
  "kickdbImageUrl",
  "supplierProductName",
  "supplierBrand",
  "lastSyncAt",
  "updatedAt",
  "supplierVariantId",
];

function csvCell(value: unknown): string {
  const str = value == null ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * GET /api/partners/catalog/export
 * Download the authenticated partner catalog with enrichment as CSV.
 */
export async function GET(req: NextRequest) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const prismaAny = prisma as any;
  const providerKey = session.partnerKey.toUpperCase().slice(0, 3);

  const variants = await prismaAny.supplierVariant.findMany({
    where: { supplierVariantId: { startsWith: `${providerKey.toLowerCase()}:` } },
    orderBy: { updatedAt: "desc" },
  });

  const variantIds = variants.map((v: any) => v.supplierVariantId).filter(Boolean);
  const mappings =
    variantIds.length > 0
      ? await prismaAny.variantMapping.findMany({
          where: { supplierVariantId: { in: variantIds } },
          include: { kickdbVariant: { include: { product: true } } },
        })
      : [];

  const mappingByVariantId = new Map<string, any>();
  for (const m of mappings) {
    if (m.supplierVariantId) mappingByVariantId.set(m.supplierVariantId, m);
  }

  const rows = variants.map((v: any) => {
    const m = mappingByVariantId.get(v.supplierVariantId) ?? null;
    const kv = m?.kickdbVariant ?? null;
    const kp = kv?.product ?? null;
    return {
      providerKey: v.providerKey ?? "",
      supplierSku: v.supplierSku ?? "",
      sizeRaw: v.sizeRaw ?? "",
      stock: v.stock ?? 0,
      price: v.price ?? "",
      gtin: v.gtin ?? m?.gtin ?? "",
      mappingStatus: m?.status ?? "NO_MAPPING",
      kickdbName: kp?.name ?? "",
      kickdbBrand: kp?.brand ?? "",
      kickdbImageUrl: kp?.imageUrl ?? "",
      supplierProductName: v.supplierProductName ?? "",
      supplierBrand: v.supplierBrand ?? "",
      lastSyncAt: v.lastSyncAt ?? "",
      updatedAt: v.updatedAt ?? "",
      supplierVariantId: v.supplierVariantId ?? "",
    };
  });

  const csvContent = [
    CSV_HEADERS.join(","),
    ...rows.map((row: Record<string, string | number | null | undefined>) =>
      CSV_HEADERS.map((header) => csvCell(row[header])).join(",")
    ),
  ].join("\n");

  const filename = `partner-stock-enriched-${providerKey.toLowerCase()}.csv`;
  return new NextResponse(csvContent, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
