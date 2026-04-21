import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { assertMappingIntegrity, normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { requestFeedPush } from "@/galaxus/ops/feedPipeline";
import { partnerOwnsSupplierVariant } from "@/app/lib/partnerCatalogScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serializeSupplierVariant(v: Record<string, unknown>) {
  const dec = (x: unknown) => (x != null ? String(x) : null);
  return {
    id: v.id,
    supplierVariantId: v.supplierVariantId,
    supplierSku: v.supplierSku,
    providerKey: v.providerKey ?? null,
    gtin: v.gtin ?? null,
    price: dec(v.price),
    stock: v.stock,
    sizeRaw: v.sizeRaw ?? null,
    sizeNormalized: v.sizeNormalized ?? null,
    supplierBrand: v.supplierBrand ?? null,
    supplierProductName: v.supplierProductName ?? null,
    supplierGender: v.supplierGender ?? null,
    supplierColorway: v.supplierColorway ?? null,
    weightGrams: v.weightGrams ?? null,
    images: v.images ?? null,
    sourceImageUrl: v.sourceImageUrl ?? null,
    hostedImageUrl: v.hostedImageUrl ?? null,
    imageSyncStatus: v.imageSyncStatus ?? null,
    imageVersion: v.imageVersion ?? null,
    imageLastSyncedAt: v.imageLastSyncedAt
      ? new Date(String(v.imageLastSyncedAt)).toISOString()
      : null,
    imageSyncError: v.imageSyncError ?? null,
    manualPrice: v.manualPrice != null ? dec(v.manualPrice) : null,
    manualStock: v.manualStock ?? null,
    manualLock: Boolean(v.manualLock),
    manualNote: v.manualNote ?? null,
    manualUpdatedAt: v.manualUpdatedAt
      ? new Date(String(v.manualUpdatedAt)).toISOString()
      : null,
    leadTimeDays: v.leadTimeDays ?? null,
    deliveryType: v.deliveryType ?? null,
    lastSyncAt: v.lastSyncAt ? new Date(String(v.lastSyncAt)).toISOString() : null,
    createdAt: v.createdAt ? new Date(String(v.createdAt)).toISOString() : null,
    updatedAt: v.updatedAt ? new Date(String(v.updatedAt)).toISOString() : null,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ supplierVariantId: string }> }
) {
  const session = await getPartnerSession(_req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isNer = session.partnerKey?.toLowerCase() === "ner";
  const { supplierVariantId } = await params;
  const decodedId = decodeURIComponent(supplierVariantId ?? "").trim();
  if (!decodedId || (!isNer && !partnerOwnsSupplierVariant(decodedId, session.partnerKey))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const row = await prisma.supplierVariant.findUnique({
    where: { supplierVariantId: decodedId },
  });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const mapping = await prisma.variantMapping.findUnique({
    where: { supplierVariantId: decodedId },
    select: { status: true, kickdbVariantId: true, gtin: true },
  });

  return NextResponse.json({
    ok: true,
    variant: serializeSupplierVariant(row as unknown as Record<string, unknown>),
    mapping: mapping
      ? { status: mapping.status, kickdbVariantId: mapping.kickdbVariantId, gtin: mapping.gtin }
      : null,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ supplierVariantId: string }> }
) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isNer = session.partnerKey?.toLowerCase() === "ner";

  const { supplierVariantId } = await params;
  const decodedSupplierVariantId = decodeURIComponent(supplierVariantId ?? "");
  if (
    !decodedSupplierVariantId ||
    (!isNer && !partnerOwnsSupplierVariant(decodedSupplierVariantId, session.partnerKey))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const stock = Number.parseInt(String(body.stock ?? ""), 10);
  const price = Number.parseFloat(String(body.price ?? ""));
  if (!Number.isFinite(stock) || stock < 0) {
    return NextResponse.json({ error: "Invalid stock" }, { status: 400 });
  }
  if (!Number.isFinite(price) || price < 0) {
    return NextResponse.json({ error: "Invalid price" }, { status: 400 });
  }

  const existing = await prisma.supplierVariant.findUnique({
    where: { supplierVariantId: decodedSupplierVariantId },
    select: { gtin: true, providerKey: true },
  });
  assertMappingIntegrity({
    supplierVariantId: decodedSupplierVariantId,
    gtin: existing?.gtin ?? null,
    providerKey: existing?.providerKey ?? null,
    status: existing?.gtin ? "MATCHED" : "PENDING_GTIN",
  });
  const updated = await prisma.supplierVariant.update({
    where: { supplierVariantId: decodedSupplierVariantId },
    data: {
      stock,
      price,
      lastSyncAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, item: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ supplierVariantId: string }> }
) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isNer = session.partnerKey?.toLowerCase() === "ner";

  const { supplierVariantId } = await params;
  const decodedSupplierVariantId = decodeURIComponent(supplierVariantId ?? "");
  if (
    !decodedSupplierVariantId ||
    (!isNer && !partnerOwnsSupplierVariant(decodedSupplierVariantId, session.partnerKey))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const prismaAny = prisma as any;
  const variant = await prismaAny.supplierVariant.findUnique({
    where: { supplierVariantId: decodedSupplierVariantId },
    select: { supplierVariantId: true, supplierSku: true, sizeNormalized: true, providerKey: true },
  });
  if (!variant) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prismaAny.variantMapping.deleteMany({ where: { supplierVariantId: decodedSupplierVariantId } });
  const pk = normalizeProviderKey(session.partnerKey);
  if (pk) {
    await prismaAny.partnerUploadRow?.deleteMany({
      where: {
        providerKey: pk,
        sku: variant.supplierSku ?? "",
        sizeNormalized: variant.sizeNormalized ?? "",
      },
    });
  }
  await prismaAny.supplierVariant.delete({ where: { supplierVariantId: decodedSupplierVariantId } });

  const origin = new URL(req.url).origin;
  await requestFeedPush({ origin, scope: "full", triggerSource: "partner-admin", runNow: true });

  return NextResponse.json({ ok: true });
}
