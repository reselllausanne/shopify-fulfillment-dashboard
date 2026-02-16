import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/partners/uploads/history
 * Returns the authenticated partner's:
 *  - SupplierVariant rows (their catalog in DB)
 *  - PartnerUpload records (upload log)
 *  - PartnerUploadRow pending/ambiguous rows
 */
export async function GET(req: NextRequest) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const prismaAny = prisma as any;
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "200"), 1000);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);

  const providerKey = session.partnerKey.toUpperCase().slice(0, 3);

  // 1) SupplierVariant rows belonging to this partner (supplierVariantId starts with "xxx:")
  const variants = await prismaAny.supplierVariant.findMany({
    where: { supplierVariantId: { startsWith: `${providerKey.toLowerCase()}:` } },
    orderBy: { updatedAt: "desc" },
    take: limit,
    skip: offset,
  });

  const variantCount = await prismaAny.supplierVariant.count({
    where: { supplierVariantId: { startsWith: `${providerKey.toLowerCase()}:` } },
  });

  // 2) VariantMapping rows linked to those variants
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

  // 3) Build combined variant rows
  const catalogRows = variants.map((v: any) => {
    const m = mappingByVariantId.get(v.supplierVariantId) ?? null;
    const kv = m?.kickdbVariant ?? null;
    const kp = kv?.product ?? null;
    return {
      supplierVariantId: v.supplierVariantId ?? "",
      providerKey: v.providerKey ?? "",
      supplierSku: v.supplierSku ?? "",
      gtin: v.gtin ?? m?.gtin ?? "",
      sizeRaw: v.sizeRaw ?? "",
      price: v.price ?? "",
      stock: v.stock ?? 0,
      lastSyncAt: v.lastSyncAt ?? null,
      updatedAt: v.updatedAt ?? null,
      mappingStatus: m?.status ?? "NO_MAPPING",
      kickdbBrand: kp?.brand ?? "",
      kickdbName: kp?.name ?? "",
      kickdbImageUrl: kp?.imageUrl ?? "",
      supplierProductName: v.supplierProductName ?? "",
      supplierBrand: v.supplierBrand ?? "",
    };
  });

  // 4) PartnerUpload history
  const uploads = await prismaAny.partnerUpload.findMany({
    where: { partnerId: session.partnerId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const uploadHistory = uploads.map((u: any) => ({
    id: u.id,
    filename: u.filename ?? "",
    status: u.status ?? "",
    totalRows: u.totalRows ?? 0,
    importedRows: u.importedRows ?? 0,
    errorRows: u.errorRows ?? 0,
    errorsJson: u.errorsJson ?? null,
    createdAt: u.createdAt ?? null,
  }));

  // 5) PartnerUploadRow pending/ambiguous (not yet resolved)
  const pendingRows = await prismaAny.partnerUploadRow.findMany({
    where: {
      providerKey,
      status: { in: ["PENDING_GTIN", "AMBIGUOUS_GTIN"] },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  const pending = pendingRows.map((r: any) => ({
    id: r.id,
    sku: r.sku ?? "",
    sizeRaw: r.sizeRaw ?? "",
    rawStock: r.rawStock ?? 0,
    price: String(r.price ?? ""),
    status: r.status ?? "",
    gtinResolved: r.gtinResolved ?? "",
    updatedAt: r.updatedAt ?? null,
  }));

  return NextResponse.json({
    ok: true,
    providerKey,
    catalog: catalogRows,
    catalogCount: variantCount,
    uploads: uploadHistory,
    pendingRows: pending,
    pendingCount: pending.length,
    nextOffset: catalogRows.length === limit ? offset + limit : null,
  });
}
