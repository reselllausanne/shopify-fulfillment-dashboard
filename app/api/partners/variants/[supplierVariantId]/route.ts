import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ownsVariant(supplierVariantId: string, partnerKey: string) {
  return supplierVariantId.toLowerCase().startsWith(`${partnerKey.toLowerCase()}:`);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ supplierVariantId: string }> }
) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { supplierVariantId } = await params;
  const decodedSupplierVariantId = decodeURIComponent(supplierVariantId ?? "");
  if (!decodedSupplierVariantId || !ownsVariant(decodedSupplierVariantId, session.partnerKey)) {
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

  const { supplierVariantId } = await params;
  const decodedSupplierVariantId = decodeURIComponent(supplierVariantId ?? "");
  if (!decodedSupplierVariantId || !ownsVariant(decodedSupplierVariantId, session.partnerKey)) {
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
  await prismaAny.partnerUploadRow?.deleteMany({
    where: {
      providerKey: variant.providerKey ?? session.partnerKey.toUpperCase(),
      sku: variant.supplierSku ?? "",
      sizeNormalized: variant.sizeNormalized ?? "",
    },
  });
  await prismaAny.supplierVariant.delete({ where: { supplierVariantId: decodedSupplierVariantId } });

  return NextResponse.json({ ok: true });
}
