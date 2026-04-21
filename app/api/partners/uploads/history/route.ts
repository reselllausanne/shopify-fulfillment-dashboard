import { NextRequest, NextResponse } from "next/server";
import { inboxRowSupplierVariantId } from "@/app/lib/partnerImport";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { partnerCatalogVariantWhere } from "@/app/lib/partnerCatalogScope";

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

  const providerKey = normalizeProviderKey(session.partnerKey);
  if (!providerKey) {
    return NextResponse.json({ error: "Invalid partner key" }, { status: 400 });
  }

  // 1) SupplierVariant rows: inbox `ner:` and Mirakl-style `NER_` / `the_` keys
  const catalogWhere = partnerCatalogVariantWhere(providerKey);
  const variants = await prismaAny.supplierVariant.findMany({
    where: catalogWhere,
    orderBy: { updatedAt: "desc" },
    take: limit,
    skip: offset,
  });

  const variantCount = await prismaAny.supplierVariant.count({
    where: catalogWhere,
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
  const pendingUploadRows = await prismaAny.partnerUploadRow.findMany({
    where: {
      providerKey,
      status: { in: ["PENDING_GTIN", "AMBIGUOUS_GTIN"] },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  const pendingVariantIds = Array.from(
    new Set(
      pendingUploadRows
        .map((r: any) => inboxRowSupplierVariantId(r))
        .filter((id: string | null): id is string => typeof id === "string" && id.length > 0)
    )
  ) as string[];
  const pendingVariants =
    pendingVariantIds.length > 0
      ? await prisma.supplierVariant.findMany({
          where: { supplierVariantId: { in: pendingVariantIds } },
          select: {
            supplierVariantId: true,
            supplierSku: true,
            sizeRaw: true,
            sizeNormalized: true,
            stock: true,
            price: true,
          },
        })
      : [];
  const pendingVariantById = new Map(pendingVariants.map((v) => [v.supplierVariantId, v]));

  const pendingEnrichCount = await prismaAny.partnerUploadRow.count({
    where: {
      providerKey,
      status: "PENDING_ENRICH",
    },
  });

  const pending = pendingUploadRows.map((r: any) => {
    const sid = inboxRowSupplierVariantId(r);
    const v = sid ? pendingVariantById.get(sid) : undefined;
    return {
      id: r.id,
      sku: v?.supplierSku ?? r.sku ?? "",
      sizeRaw: v?.sizeRaw ?? r.sizeRaw ?? "",
      rawStock: v?.stock ?? r.rawStock ?? 0,
      price: String(v?.price ?? r.price ?? ""),
      status: r.status ?? "",
      gtinResolved: r.gtinResolved ?? "",
      updatedAt: r.updatedAt ?? null,
    };
  });

  return NextResponse.json({
    ok: true,
    providerKey,
    catalog: catalogRows,
    catalogCount: variantCount,
    uploads: uploadHistory,
    pendingRows: pending,
    pendingCount: pending.length,
    pendingEnrichCount,
    nextOffset: catalogRows.length === limit ? offset + limit : null,
  });
}
